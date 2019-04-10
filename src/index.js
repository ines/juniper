import CodeMirror from 'codemirror';
import python from 'codemirror/mode/python/python';
import { Widget } from '@phosphor/widgets';
import { Kernel, ServerConnection } from '@jupyterlab/services';
import { OutputArea, OutputAreaModel } from '@jupyterlab/outputarea';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';

// based on Thebelab by Min RK, licensed under BSD 3-Clause
// https://github.com/minrk/thebelab

class Juniper {
    /**
     * Initialise Juniper
     * @param {Object} - The configuration parameters.
     */
    constructor(options = {}) {
        this._kernel = null;
        this._renderers = null;
        this._fromStorage = false;

        this.selector = options.selector || '[data-executable]';
        this.repo = options.repo;
        this.branch = options.branch || 'master';
        this.url = options.url || 'https://mybinder.org';
        this.serverSettings = options.serverSettings || {};
        this.kernelType = options.kernelType || 'python3';
        this.defaultLang = options.language || 'python';
        this.defaultTheme = options.theme || 'default';
        this.isolateCells = options.isolateCells == undefined ? true : options.isolateCells;
        this.useBinder = options.useBinder == undefined ? true : options.useBinder;
        this.useStorage = options.useStorage == undefined ? true : options.useStorage;
        this.storageKey = options.storageKey || 'juniper';
        this.storageExpire = options.storageExpire || 60;
        this.eventName = options.eventName || 'juniper';
        this.msgLoading = options.msgLoading || 'Loading...';
        this.msgError = options.msgError || 'Connecting failed. Please reload and try again.';
        const classNames = options.classNames || {};
        this.classNames = {
            cell: classNames.cell || 'juniper-cell',
            input: classNames.input || 'juniper-input',
            button: classNames.button || 'juniper-button',
            output: classNames.output || 'juniper-output'
        };

        if (!options.noAutoInit) {
            const allCells = [...document.querySelectorAll(this.selector)];
            allCells.forEach(cell => this.renderCell(cell));
        }
    }

    /**
     * Get a kernel by requesting a binder or from localStorage / user settings
     * @returns {Promise}
     */
    getKernel() {
        if (this.useStorage && typeof window !== 'undefined') {
            const stored = window.localStorage.getItem(this.storageKey);
            if (stored) {
                this._fromStorage = true;
                const { settings, timestamp } = JSON.parse(stored);
                if (timestamp && new Date().getTime() < timestamp) {
                    return this.requestKernel(settings);
                }
                window.localStorage.removeItem(this.storageKey);
            }
        }
        if (this.useBinder) {
            return this.requestBinder(this.repo, this.branch, this.url)
                .then(settings => this.requestKernel(settings))
        }
        return this.requestKernel(this.serverSettings);
    }

    /**
     * Request a binder, e.g. from mybinder.org
     * @param {string} repo - Repository name in the format 'user/repo'.
     * @param {string} branch - The repository branch, e.g. 'master'.
     * @param {string} url - The binder reployment URL, including 'http(s)'.
     * @returns {Promise} - Resolved with Binder settings, rejected with Error.
     */
    requestBinder(repo, branch, url) {
        const binderUrl = `${url}/build/gh/${repo}/${branch}`;
        this._event('building', { binderUrl });
        return new Promise((resolve, reject) => {
            const es = new EventSource(binderUrl);
            es.onerror = err => {
                es.close();
                this._event('failed');
                reject(new Error(err));
            }
            let phase = null;
            es.onmessage = ({ data }) => {
                const msg = JSON.parse(data);
                if (msg.phase && msg.phase != phase) {
                    phase = msg.phase.toLowerCase();
                    this._event(phase == 'ready' ? 'server-ready' : phase);
                }
                if (msg.phase == 'failed') {
                    es.close();
                    reject(new Error(msg));
                }
                else if (msg.phase == 'ready') {
                    es.close();
                    const settings = {
                        baseUrl: msg.url,
                        wsUrl: `ws${msg.url.slice(4)}`,
                        token: msg.token
                    };
                    resolve(settings);
                }
            }
        });
    }

    /**
     * Request kernel and estabish a server connection via the JupyerLab service
     * @param {object} settings - The server settings.
     * @returns {Promise} - A promise that's resolved with the kernel.
     */
    requestKernel(settings) {
        if (this.useStorage && typeof window !== 'undefined') {
            const timestamp = new Date().getTime() + this.storageExpire * 60 * 1000;
            const json = JSON.stringify({ settings, timestamp });
            window.localStorage.setItem(this.storageKey, json);
        }
        const serverSettings = ServerConnection.makeSettings(settings);
        return Kernel.startNew({ type: this.kernelType, name: this.kernelType, serverSettings })
            .then(kernel => {
                this._event('ready');
                return kernel;
            });
    }

    /**
     * Render an individual code cell and replace it with CodeMirror
     * @param {Node} $element - The element containing the code.
     */
    renderCell($element) {
        const outputArea = new OutputArea({
            model: new OutputAreaModel({ trusted: true }),
            rendermime: new RenderMimeRegistry({
                initialFactories: this.getRenderers()
            })
        });

        const $cell = this._$('div', this.classNames.cell);
        $element.replaceWith($cell);
        const $input = this._$('div', this.classNames.input);
        $cell.appendChild($input);
        const $button = this._$('button', this.classNames.button, 'run');
        $cell.appendChild($button);
        const $output = this._$('div', this.classNames.output);
        $cell.appendChild($output);
        Widget.attach(outputArea, $output);

        const cm = new CodeMirror($input, {
            value: $element.textContent.trim(),
            mode: $element.getAttribute('data-language') || this.defaultLang,
            theme: $element.getAttribute('data-theme') || this.defaultTheme
        });

        const runCode = ev => this.execute(outputArea, cm.getValue());
        cm.setOption('extraKeys', { 'Shift-Enter': runCode });
        $button.addEventListener('click', runCode);
    }

    /**
     * Render the kernel response in a JupyterLab output area
     * @param {OutputArea} outputArea - The cell's output area.
     * @param {string} code - The code to execute.
     */
    render(outputArea, code) {
        outputArea.future = this._kernel.requestExecute({ code });
        outputArea.model.add({
            output_type: 'stream',
            name: 'loading',
            text: this.msgLoading
        });
        outputArea.model.clear(true);
    }

    /**
     * Process request to execute the code
     * @param {OutputArea} - outputArea - The cell's output area.
     * @param {string} code - The code to execute.
     */
    execute(outputArea, code) {
        this._event('executing');
        if (this._kernel) {
            if (this.isolateCells) {
                this._kernel.restart()
                    .then(() => this.render(outputArea, code))
                    .catch(() => {
                        this._event('failed');
                        this._kernel = null;
                        outputArea.model.clear();
                        outputArea.model.add({
                            output_type: 'stream',
                            name: 'failure',
                            text: this.msgError
                        });
                    })
                return;
            }
            this.render(outputArea, code);
            return;
        }
        this._event('requesting-kernel');
        const url = this.url.split('//')[1];
        const action = !this._fromStorage ? 'Launching' : 'Reconnecting to';
        outputArea.model.clear();
        outputArea.model.add({
            output_type: 'stream',
            name: 'stdout',
            text: `${action} Docker container on ${url}...`
        });
        new Promise((resolve, reject) =>
            this.getKernel().then(resolve).catch(reject))
            .then(kernel => {
                this._kernel = kernel;
                this.render(outputArea, code);
            })
            .catch(() => {
                this._event('failed');
                this._kernel = null;
                if (this.useStorage && typeof window !== 'undefined') {
                    this._fromStorage = false;
                    window.localStorage.removeItem(this.storageKey);
                }
                outputArea.model.clear();
                outputArea.model.add({
                    output_type: 'stream',
                    name: 'failure',
                    text: this.msgError
                });
            })
    }

    /**
     * Get the renderers for a cell
     * @returns {Array} - The Jupyter render factories.
     */
    getRenderers() {
        if(!this._renderers) {
            this._renderers = standardRendererFactories.filter(factory =>
                factory.mimeTypes.includes('text/latex') ?
                    (typeof window !== 'undefined' && window.MathJax) : true);
        }
        return this._renderers;
    }

    /**
     * Dispatch a custom event exposing status and data as event.detail
     * @param {string} status - The event status, e.g. 'ready'.
     * @param data - Additional data to attach to the event.
     */
    _event(status, data) {
        const ev = new CustomEvent(this.eventName, { detail: { status, data } })
        document.dispatchEvent(ev);
    }

    /**
     * Helper to create DOM elements
     * @param {string} tag - The element tag, e.g. 'div'.
     * @param {string} classNames - Optional class names as one string.
     * @param {string} textContent - Optional element text content.
     * @returns {Node} - The created DOM element.
     */
    _$(tag, classNames = '', textContent = '') {
        const el = document.createElement(tag);
        el.className = classNames;
        el.textContent = textContent;
        return el;
    }
}

if (typeof window != 'undefined') {
    window.Juniper = Juniper;
    window.CodeMirror = CodeMirror;
}

export default Juniper;
