import { Component, ViewContainerRef, ComponentFactoryResolver } from '@angular/core';
import { GaugeBaseComponent } from '../../gauge-base/gauge-base.component';
import { GaugeActionsType, Event, GaugeSettings, GaugeStatus, View, Variable, GaugeEventType, GaugeEventActionType } from '../../../_models/hmi';
import { Utils } from '../../../_helpers/utils';
import { GaugeDialogType } from '../../gauge-property/gauge-property.component';
import { HmiService } from '../../../_services/hmi.service';
import { EndPointApi } from '../../../_helpers/endpointapi';
import { RepeaterUtils } from '../../../_models/repeater';
import { GaugesManager } from '../../gauges.component';
declare function initializeHtml5QrCode(id: any): void;

@Component({
    selector: 'app-repeater',
    templateUrl: './repeater.component.html',
    styleUrls: ['./repeater.component.css']
})
export class RepeaterComponent extends GaugeBaseComponent {

    static scripts : any;
    static viewObjectsScripts : any;
    static endPointConfig: string = EndPointApi.getURL();
    static TypeTag = 'svg-ext-own_ctrl-repeat';
    static LabelTag = 'Repeater';
    static prefixD = 'D-OXC_';
    static tagsRepeaterData = {};
    /** ids of the tags shown live by the items while rendering (e.g. @tags.Temperature with a tagList entry) */
    static renderLiveTags: Set<string> = null;
    static hmi: HmiService = null;

    static actionsType = { hide: GaugeActionsType.hide, show: GaugeActionsType.show, blink: GaugeActionsType.blink, stop: GaugeActionsType.stop,
                        clockwise: GaugeActionsType.clockwise, anticlockwise: GaugeActionsType.anticlockwise, rotate : GaugeActionsType.rotate,
                        move: GaugeActionsType.move};
                    
    constructor() {
        super();
    }

    static initElement(gaugeSettings: GaugeSettings, gaugeManager: GaugesManager, hmiService: HmiService, resolver: ComponentFactoryResolver, viewContainerRef: ViewContainerRef, isview: boolean, parent?: any): RepeaterComponent {
        let ele = document.getElementById(gaugeSettings.id);
        const createComponent = () => {
            let factory = resolver.resolveComponentFactory(RepeaterComponent);
            const componentRef = viewContainerRef.createComponent(factory);
            return componentRef.instance;
        };
        // A newly drawn Repeater has no settings yet: add it to the view and render
        // the data once a Repeater data source (with at least one line) is selected.
        let _repeater = gaugeSettings.property?.repeaterData ? hmiService.getRepeater(gaugeSettings.property.repeaterData) : null;
        const dataLine = _repeater?.lines?.[0];
        if (!dataLine) {
            return createComponent();
        }
        let dataJSONProperties = (dataLine.url_data_properties || '').split(",");
        let dataJSONPropertyToShow = gaugeSettings.property.repeaterDataPropertyToShow;
        let dataJSONTags = {};
        Object.values(gaugeSettings.property.repeaterDataSource || {}).forEach(val => {
            if (val['repeaterDataId']) {
                if (val['repeaterDataId']!=='') {
                    dataJSONTags[val['repeaterDataId']] = val['id'];
                    this.tagsRepeaterData[val['id']] = val;
                }
            }
        });
        hmiService.askDeviceValues();
        this.hmi = hmiService;
        let view = gaugeSettings.property.view;
        var doc = new DOMParser();
        if (ele) {
            let svgDivContainer = Utils.searchTreeStartWith(ele, this.prefixD);
            while (svgDivContainer.firstChild) {
                svgDivContainer.removeChild(svgDivContainer.lastChild);
            }
            svgDivContainer.style['overflow'] = 'auto';
            // toolbar (QR reader, search input and buttons) stays at the top, only the items scroll
            var toolbar = document.createElement("div");
            toolbar.className = "repeater-toolbar";
            toolbar.style.position = "sticky";
            toolbar.style.top = "0";
            toolbar.style.zIndex = "1";
            const containerBackground = getComputedStyle(svgDivContainer).backgroundColor;
            toolbar.style.backgroundColor = (!containerBackground || containerBackground === 'transparent' || containerBackground === 'rgba(0, 0, 0, 0)') ? '#ffffff' : containerBackground;
            if (isview) {
                // the control group has pointer-events:none (editor), the toolbar must be usable in the view
                toolbar.style.pointerEvents = "auto";
            }
            svgDivContainer.appendChild(toolbar);
            this.bindSearch(svgDivContainer);
            var divReader = document.createElement("div");
            divReader.style.display = "table"
            divReader.style.width = "100%";
            divReader.id= "reader";
            toolbar.appendChild(divReader); 
            
            var divInput = document.createElement("div");
            divInput.style.display = "table"
            divInput.style.width = "100%";
            toolbar.appendChild(divInput);         
            
            var input = document.createElement("input");
            input.type ="text";
            input.id = "repeater_html5_qrcode_input";
            input.setAttribute("onblur", "onChangeInput()");
            divInput.appendChild(input);         
            var divReaderStartButtonStart = document.createElement("button");
            divReaderStartButtonStart.id = "repeater_html5_qrcode_start";
            divReaderStartButtonStart.setAttribute('content', 'QR +');
            divReaderStartButtonStart.setAttribute('class', 'repeater-html5-qrcode-start');  
            divReaderStartButtonStart.textContent = 'QR +';
            divInput.appendChild(divReaderStartButtonStart);
            var divReaderStartButtonStop = document.createElement("button");
            divReaderStartButtonStop.id = "repeater_html5_qrcode_stop";
            divReaderStartButtonStop.setAttribute('content', 'QR -');
            divReaderStartButtonStop.setAttribute('class', 'repeater-html5-qrcode-stop');  
            divReaderStartButtonStop.textContent = 'QR -';
            divInput.appendChild(divReaderStartButtonStop);

            var divInputSearch = document.createElement("div");
            divInputSearch.style.display = "table"
            divInputSearch.style.width = "100%";
            toolbar.appendChild(divInputSearch);         
            var divReaderSearch = document.createElement("button");
            divReaderSearch.id = "repeater_input_search";
            divReaderSearch.setAttribute('content', '...');
            divReaderSearch.setAttribute('class', 'repeater-input-search');  
            divReaderSearch.style.width = "100%";
            divReaderSearch.textContent = '...';
            divInputSearch.appendChild(divReaderSearch);

            let v: View = this.getView(hmiService, view);
            if (!v) {
                initializeHtml5QrCode(gaugeSettings.id);
                return createComponent();
            }
            if (v.items?.[gaugeSettings.id]) {
                // the Repeater would copy the page it is placed in (including itself) for every item
                const message = document.createElement("div");
                message.style.padding = "5px";
                message.textContent = 'Repeater: select a different view, a Repeater cannot repeat the view it is placed in.';
                svgDivContainer.appendChild(message);
                initializeHtml5QrCode(gaugeSettings.id);
                return createComponent();
            }
            // in the view, clicks on the items run the events of the template controls through the hosting view
            svgDivContainer['repeaterContext'] = { view: v, parent, gaugeManager };
            if (isview && parent) {
                this.bindItemEvents(svgDivContainer);
            }
            this.viewObjectsScripts = {};
            Object.entries(v.items).forEach(entry => {
                try {
                    for(let e =0; e < entry[1]['property']['events'].length; e++) {
                        this.viewObjectsScripts[entry[1]['id'].toLowerCase()] = entry[1]['property']['events'][e]['actparam'];
                    }
                } catch (err) {}
            });
            this.scripts = hmiService.projectService.getScripts();
            RepeaterUtils.getItems(dataLine, _repeater.id).subscribe({ error: (err) => console.error(`Repeater: cannot load ${RepeaterUtils.isDb(dataLine) ? 'the DB data' : dataLine.url}`, err), next: result => {
                let jsonObj = result;
                if (svgDivContainer['repeaterContext']) {
                    svgDivContainer['repeaterContext'].items = jsonObj;
                }
                const fieldBindings = this.getFieldBindings(v);
                this.renderLiveTags = new Set<string>();
                Object.entries(jsonObj || {}).forEach(entry => {
                    if (svgDivContainer) {
                        try {
                            // without configured properties every field of the item is used (e.g. the columns of a DB row)
                            const itemProperties = dataJSONProperties.some(p => p) ? dataJSONProperties
                                : (entry[1] && typeof entry[1] === 'object' ? Object.keys(entry[1]) : []);
                            let prop = [entry, itemProperties];
                            var xml = doc.parseFromString(v.svgcontent, "image/svg+xml");
                            // a Repeater saved inside the repeated view (toolbar and rendered items) is not repeated
                            this.removeRepeaters(xml);
                            this.applyFieldBindings(xml, fieldBindings, entry[1]);
                            var svgNodes = xml.getElementsByTagName("svg");
                            this.modifyIdsOfElements(svgNodes, prop, dataJSONPropertyToShow, dataJSONTags, hmiService.variables);
                            this.applyViewStyle(svgNodes[0], v);
                            if (isview) {
                                (<SVGElement>svgNodes[0]).style.pointerEvents = 'auto';
                            }
                            svgNodes[0].setAttribute('data-repeater-item', entry[0]);
                            svgDivContainer.appendChild(svgNodes[0]);
                        } catch (err) {
                            console.error(`Repeater: cannot render item ${entry[0]}`, err);
                        }
                    }
                });
                const liveTags = Array.from(this.renderLiveTags);
                this.renderLiveTags = null;
                this.bindLiveTags(svgDivContainer, gaugeSettings.id, liveTags, hmiService);
                setTimeout(function() {
                    var content = svgDivContainer.innerHTML;
                    svgDivContainer.innerHTML= content;
                }, 1000); 
            } });

        }
        initializeHtml5QrCode(gaugeSettings.id);
        return createComponent();
    }

    static getScript = function (scriptsMap, _script) {
        return Object.entries(scriptsMap).find(s => s[1]['id'] === _script);
    }

    static modifyIdsOfElements(node, properties, property, tags, variables) {
        let _data = "";
        let flgTagExist = '';
        let flgTagName = false;
        for(let j=0; j < properties[1].length; j++) {
            if (_data !== "") {
                _data += "&";
            }
            if (tags.hasOwnProperty(properties[0][1][properties[1][j]])) {
                flgTagExist = tags[properties[0][1][properties[1][j]]];
            }
            if (properties[1][j]==='tagName') {
                _data += properties[1][j] + "|"+ flgTagExist;
                flgTagName = true;
            } else {
                _data += properties[1][j] + "|"+ RepeaterComponent.fieldText(properties[0][1][properties[1][j]]);
            }
        }
        if (!flgTagName) {
            _data += (_data !== "" ? "&" : "") + "tagName|" + flgTagExist;
        }
        let _id = properties[0][0];
        for(let i = 0; i < node.length; i++)
            if (node[i].nodeType == 1) {
                let _text = properties[0][1][property];
                node[i].setAttribute("data", _data);
                node[i].style.display = "flex";
                this.recurseAndAdd(node[i], _data, _id, _text, tags, variables, properties[0][1]);
            }
    }

    static recurseAndAdd(el, _data, _id, _text, tags, variables, item?: any) {
        var children = el.childNodes;
        for(let i=0; i < children.length; i++) {
            if (children[i].nodeType == 1 )
            if (!children[i].getAttribute("tagname")) {
                if ('id' in children[i]){
                    let id = children[i].id;
                    if (this.viewObjectsScripts.hasOwnProperty(id.toLowerCase())){
                        // only events running a CLIENT script are wired, other events (e.g. open a view) are skipped
                        let scriptEntry = this.getScript(this.scripts || [], this.viewObjectsScripts[id.toLowerCase()]);
                        let script = scriptEntry?.[1];
                        if (script?.['mode'] === 'CLIENT') {
                            children[i].setAttribute("onclick",script['code']);
                        }
                    }
                    if (children[i].id !== '' && !children[i].getAttribute("tagname")) {
                        children[i].id = children[i].id + "_" + _id;
                    }
                    children[i].setAttribute("data", _data);
                    if (children[i].nodeName.toLowerCase() === "text" ||
                        children[i].nodeName.toLowerCase() === "input" ||
                        children[i].nodeName.toLowerCase() === "button")
                        if (_data.indexOf(children[i].innerHTML.replace("@","")+"|") >=0 ||
                            (children[i].innerHTML.startsWith('@') && RepeaterComponent.getItemField(item, children[i].innerHTML.substring(1)) !== undefined)) {
                            if (children[i].innerHTML === "@tagName") {
                                // to add a div with the tag name
                                children[i].innerHTML = '';
                                children[i].id = (tags[_id] ? tags[_id]: "hidden" + _id);
                                let _tmpProp = Object.values(this.tagsRepeaterData).find( (e:any) => e.id == tags[_id]);
                                let _tmpVal = "";
                                if (_tmpProp) {
                                    if (_tmpProp.hasOwnProperty("valueWillBeShowed"))
                                        if (_tmpProp["valueWillBeShowed"]) {
                                            let _tmp = Object.values(variables).find( (e:any) => e.id == tags[_id]);
                                            if (_tmp["value"])
                                                _tmpVal = (_tmpProp["valueObjectProperty"] && _tmpProp["valueObjectProperty"]!="" ? _tmpProp["valueObjectProperty"] : "") + " " + (_tmp ? (_tmp["value"] === undefined ? "" : (_tmpProp["valueIsObject"] ? JSON.parse(_tmp["value"])[_tmpProp["valueObjectProperty"]] : _tmp["value"])) : "");
                                            _tmpVal = _tmpVal  + (_tmpVal !== "" ? " [" + Math.round(+new Date()/1000) + "]" : "");
                                        } else {
                                            _tmpVal = "";
                                        }
                                    else
                                        _tmpVal = "";
                                } else {
                                    _tmpVal = "";
                                }
                                children[i].innerHTML = _tmpVal;
                            } else {
                                // @field shows the value of that field of the item (fallback: the 'property to show')
                                const field = children[i].innerHTML.replace("@", "");
                                const fieldValue = RepeaterComponent.resolveField(item, field, children[i]);
                                const value = (fieldValue !== undefined && fieldValue !== null) ? fieldValue : _text;
                                children[i].textContent = RepeaterComponent.fieldText(value);
                            }
                        }
                    try {
                        if (_data.indexOf("&tagName|&")>=0) {
                            children[i].setAttribute("disabled","true");
                            children[i].style.backgroundColor = "rgb(112,112,112)";
                        }
                    } catch (e) {}
                }
                this.recurseAndAdd(children[i], _data, _id, _text, tags, variables, item);
            }
        }
    }

    static isNode(o){
        return (
          typeof Node === "object" ? o instanceof Node : 
          o && typeof o === "object" && typeof o.nodeType === "number" && typeof o.nodeName==="string"
        );
    }

    static getSignals(pro: any) {
        let res: string[] = [];
        if (pro.variableId) {
            res.push(pro.variableId);
        }
        if (pro.alarmId) {
            res.push(pro.alarmId);
        }
        if (pro.actions && pro.actions.length) {
            pro.actions.forEach(act => {
                res.push(act.variableId);
            });
        }
        return res;
    }
    
    static getDialogType(): GaugeDialogType {
        return GaugeDialogType.Repeater;
    }

    static getActions(type: string) {
        return this.actionsType;
    }

    static processValue(ga: GaugeSettings, svgele: any, sig: Variable, gaugeStatus: GaugeStatus, repeater?: any) {
        try {
            if (svgele.node) {
                let _node = svgele.node;
                let _h = document.getElementById(sig.id);
                if (_h){
                    let _val = sig.value;
                    let _tmpProp = Object.values(this.tagsRepeaterData).find( (e:any) => e.id == sig.id);
                    if (_tmpProp) {
                        if (_tmpProp.hasOwnProperty("valueWillBeShowed")){
                            if (_tmpProp["valueWillBeShowed"]) {
                                _val = (_tmpProp["valueObjectProperty"] && _tmpProp["valueObjectProperty"]!="" ? _tmpProp["valueObjectProperty"] : "") + " " + (_tmpProp["valueIsObject"] ? JSON.parse(_val)[_tmpProp["valueObjectProperty"]] : _val);
                                _val = _val + (_val !== "" ? " [" + Math.round(+new Date()/1000) + "]" : "");
                            }
                        }
                    }
                    if (sig.value) {
                        _h.innerHTML = _val;
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    static getHtmlEvents(ga: GaugeSettings): Event {
        return null;
    }

    static detectChange(gab: GaugeSettings, gaugeManager: GaugesManager, hmiService: HmiService, resolver: ComponentFactoryResolver, viewContainerRef: ViewContainerRef ): RepeaterComponent {
        return RepeaterComponent.initElement(gab, gaugeManager, hmiService, resolver, viewContainerRef, false);
    }

    /**
     * The item is placed inside the Repeater group, whose fill/stroke (white fill and black stroke by default)
     * would be inherited by the item elements without their own colors: reset them to the SVG defaults,
     * as in the standalone view, and use the view background color (not part of the view SVG content).
     */
    static applyViewStyle(itemSvg: Element, view: View) {
        const style = (<SVGElement>itemSvg).style;
        if (!style) {
            return;
        }
        style.setProperty('fill', '#000000');
        style.setProperty('stroke', 'none');
        style.setProperty('stroke-width', '1');
        if (view.profile?.bkcolor) {
            style.setProperty('background-color', view.profile.bkcolor);
        }
    }

    /**
     * Search in the toolbar: filter the items while typing, on Enter or with the search button.
     * Listeners are delegated to the container because its content is rebuilt after rendering.
     */
    static bindSearch(container: HTMLElement) {
        if (container['repeaterSearchBound']) {
            return;
        }
        container['repeaterSearchBound'] = true;
        const isSearchInput = (target: EventTarget) => (<HTMLElement>target)?.id === 'repeater_html5_qrcode_input';
        container.addEventListener('input', (event) => {
            if (isSearchInput(event.target)) {
                RepeaterComponent.filterItems(container);
            }
        });
        container.addEventListener('keydown', (event: KeyboardEvent) => {
            if (isSearchInput(event.target)) {
                event.stopPropagation();        // keep the keys away from the editor shortcuts
                if (event.key === 'Enter') {
                    event.preventDefault();
                    RepeaterComponent.filterItems(container);
                }
            }
        });
        container.addEventListener('click', (event) => {
            if ((<HTMLElement>event.target)?.closest?.('#repeater_input_search')) {
                RepeaterComponent.filterItems(container);
            }
        });
    }

    /**
     * Run the click events (open dialog, open view, set value, ...) of the template control under the click.
     * Item element ids are '<template id>_<item key>'. CLIENT scripts are left to the onclick attribute
     * set while rendering (it gets the item data as 'this'), to not run them twice.
     */
    static bindItemEvents(container: HTMLElement) {
        if (container['repeaterEventsBound']) {
            return;
        }
        container['repeaterEventsBound'] = true;
        const runScriptAction = Utils.getEnumKey(GaugeEventActionType, GaugeEventActionType.onRunScript);
        container.addEventListener('click', (event: MouseEvent) => {
            const context = container['repeaterContext'];
            const target = <Element>event.target;
            const itemRoot = target?.closest?.('[data-repeater-item]');
            if (!context?.parent || !itemRoot) {
                return;
            }
            const suffix = '_' + itemRoot.getAttribute('data-repeater-item');
            for (let node: Element = target; node && node !== itemRoot; node = node.parentElement) {
                if (!node.id) {
                    continue;
                }
                const templateId = node.id.endsWith(suffix) ? node.id.slice(0, -suffix.length) : node.id;
                const settings: GaugeSettings = context.view.items?.[templateId];
                if (!settings) {
                    continue;
                }
                const scripts = this.scripts || [];
                const events = (context.gaugeManager.getBindMouseEvent(settings, GaugeEventType.click) || []).filter(ev =>
                    !(ev.action === runScriptAction && scripts.find(s => s.id === ev.actparam)?.mode === 'CLIENT'));
                if (events.length) {
                    // pass the item fields to the opened view/dialog as placeholder values ('@country' -> item.country)
                    const placeholderValues = this.getPlaceholderValues(context.items?.[itemRoot.getAttribute('data-repeater-item')]);
                    const itemEvents = events.map(ev => ({ ...ev, actoptions: { ...ev.actoptions, placeholderValues } }));
                    const self = context.parent.parent || context.parent;
                    self.runEvents(self, settings, event, itemEvents);
                }
                return;
            }
        });
    }

    /** show only the items with a value containing the search text (case insensitive), all with empty search */
    static filterItems(container: HTMLElement) {
        const input = <HTMLInputElement>container.querySelector('#repeater_html5_qrcode_input');
        const search = (input?.value || '').trim().toLowerCase();
        Array.from(container.children).forEach((item: HTMLElement) => {
            if (item.nodeName.toLowerCase() !== 'svg') {
                return;
            }
            const values = (item.getAttribute('data') || '').split('&').map(pair => pair.substring(pair.indexOf('|') + 1));
            const text = (values.join(' ') + ' ' + (item.textContent || '')).toLowerCase();
            item.style.display = (!search || text.includes(search)) ? 'flex' : 'none';
        });
    }

    /** controls of the repeated view bound to an item field: tag set to '@field' (e.g. an Output with tag @country) */
    /** map the item fields to placeholders: { country: 'Italy' } -> { '@country': 'Italy' }, a plain value -> { '@value': value } */
    static getPlaceholderValues(item: any): { [placeholder: string]: any } {
        const values = {};
        if (item !== null && typeof item === 'object') {
            Object.entries(item).forEach(([key, value]) => {
                values['@' + key] = (value !== null && typeof value === 'object') ? JSON.stringify(value) : value;
            });
        } else if (item !== undefined) {
            values['@value'] = item;
        }
        return values;
    }

    static getFieldBindings(view: View): { id: string, field: string }[] {
        return Object.values(view.items || {})
            .filter(item => typeof item?.property?.variableId === 'string' && item.property.variableId.startsWith('@'))
            .map(item => ({ id: item.id, field: item.property.variableId.substring(1) }))
            .filter(binding => binding.field && binding.field !== 'tagName');
    }

    /** show the item field value in the text of the bound controls */
    static applyFieldBindings(xml: Document, bindings: { id: string, field: string }[], item: any) {
        bindings.forEach(binding => {
            const element = xml.querySelector(`[id="${binding.id}"]`);
            const text = element?.nodeName.toLowerCase() === 'text' ? element : element?.querySelector('text');
            if (text && item) {
                text.textContent = RepeaterComponent.fieldText(RepeaterComponent.resolveField(item, binding.field, text));
            }
        });
    }

    /**
     * value of an item field to show in an element. A field that is a tag entry (object with id and value,
     * e.g. @tags.Temperature with tags from devices.tagList) or its value (@tagList.Temperature.value)
     * is shown live: the element is marked with the tag id and updated on every value change
     */
    static resolveField(item: any, field: string, element: Element): any {
        let current = RepeaterUtils.decodeJson(RepeaterUtils.getField(item, field));
        const tagId = RepeaterUtils.getFieldTagId(item, field);
        if (tagId) {
            if (RepeaterUtils.isTagEntry(current)) {
                current = current.value;
            }
            element.setAttribute('data-repeater-tag', tagId);
            RepeaterComponent.renderLiveTags?.add(tagId);
            const variable = RepeaterComponent.hmi?.variables?.[tagId];
            if (variable && variable.value !== undefined && variable.value !== null) {
                current = variable.value;
            }
        }
        return current;
    }

    /** subscribe the tags shown live by the items and update their elements on value change */
    static bindLiveTags(container: HTMLElement, repeaterId: string, tagIds: string[], hmiService: HmiService) {
        container['repeaterLiveTags']?.unsubscribe();
        container['repeaterLiveTags'] = null;
        hmiService.setExtraTagsSubscription('repeater-' + repeaterId, tagIds);
        if (!tagIds.length) {
            return;
        }
        const ids = new Set(tagIds);
        const subscription = hmiService.onVariableChanged.subscribe(sig => {
            if (!container.isConnected) {
                // the view was closed
                subscription.unsubscribe();
                hmiService.setExtraTagsSubscription('repeater-' + repeaterId, []);
                return;
            }
            if (!ids.has(sig?.id)) {
                return;
            }
            const text = RepeaterComponent.fieldText(sig.value);
            container.querySelectorAll(`[data-repeater-tag="${CSS.escape(sig.id)}"]`).forEach(element => {
                if (element.textContent !== text) {
                    element.textContent = text;
                }
            });
        });
        container['repeaterLiveTags'] = subscription;
    }

    /** value of an item field, also nested with a dotted path: 'tagList.Temperature.value' (JSON text decoded) */
    static getItemField(item: any, field: string): any {
        return RepeaterUtils.getField(item, field);
    }

    /** text of a field value, objects as JSON */
    static fieldText(value: any): string {
        if (value === undefined || value === null) {
            return '';
        }
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    /** remove the Repeater controls (with their toolbar and rendered items) from a parsed view */
    static removeRepeaters(xml: Document) {
        xml.querySelectorAll(`[type^="${RepeaterComponent.TypeTag}"], .repeater-toolbar`).forEach(element => element.remove());
    }

    /**
     * The editor saves the view SVG as shown, so a Repeater would be saved with its toolbar and all
     * rendered items: keep its container empty in the saved content (it is rendered again on load).
     */
    static stripRenderedContent(svgContent: string): string {
        if (!svgContent || svgContent.indexOf(RepeaterComponent.TypeTag) < 0) {
            return svgContent;
        }
        try {
            const xml = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
            if (xml.getElementsByTagName('parsererror').length) {
                return svgContent;
            }
            xml.querySelectorAll(`[type^="${RepeaterComponent.TypeTag}"]`).forEach(repeater => {
                repeater.querySelectorAll(`[id^="${RepeaterComponent.prefixD}"]`).forEach(container => {
                    while (container.firstChild) {
                        container.removeChild(container.firstChild);
                    }
                });
            });
            // an emptied container would be written as '<DIV/>', the view (HTML parser) would not close it
            return Utils.fixSelfClosingHtml(new XMLSerializer().serializeToString(xml));
        } catch (err) {
            console.error('Repeater: cannot clean the view content', err);
            return svgContent;
        }
    }

    static getView(hmiService: HmiService, name: string) {
        for (var i = 0; i < hmiService.hmi.views.length; i++) {
            if (hmiService.hmi.views[i].id === name) {
                return hmiService.hmi.views[i];
            }
        }
        return null;
    }

}
