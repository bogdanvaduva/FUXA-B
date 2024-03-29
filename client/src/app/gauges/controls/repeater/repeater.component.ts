import { Component, ViewContainerRef, ComponentFactoryResolver } from '@angular/core';
import { GaugeBaseComponent } from '../../gauge-base/gauge-base.component';
import { GaugeActionsType, Event, GaugeSettings, GaugeStatus, View, Variable } from '../../../_models/hmi';
import { Utils } from '../../../_helpers/utils';
import { GaugeDialogType } from '../../gauge-property/gauge-property.component';
import { HmiService } from '../../../_services/hmi.service';
import { EndPointApi } from '../../../_helpers/endpointapi';
import { GaugesManager } from '../../gauges.component';
declare function initializeHtml5QrCode(id: any): void;

@Component({
    selector: 'app-repeater',
    templateUrl: './repeater.component.html',
    styleUrls: ['./repeater.component.css']
})
export class RepeaterComponent extends GaugeBaseComponent {

    static scripts;
    static viewObjectsScripts;
    static endPointConfig: string = EndPointApi.getURL();
    static TypeTag = 'svg-ext-own_ctrl-repeat';
    static LabelTag = 'Repeater';
    static prefixD = 'D-OXC_';
    
    static actionsType = { hide: GaugeActionsType.hide, show: GaugeActionsType.show, blink: GaugeActionsType.blink, stop: GaugeActionsType.stop,
                        clockwise: GaugeActionsType.clockwise, anticlockwise: GaugeActionsType.anticlockwise, rotate : GaugeActionsType.rotate,
                        move: GaugeActionsType.move};
                    
    constructor() {
        super();
    }

    static initElement(gaugeSettings: GaugeSettings, gaugeManager: GaugesManager, hmiService: HmiService, resolver: ComponentFactoryResolver, viewContainerRef: ViewContainerRef, isview: boolean): RepeaterComponent {
        let ele = document.getElementById(gaugeSettings.id);
        let _repeater = hmiService.getRepeater(gaugeSettings.property.repeaterData);
        let dataJSONURL = _repeater.lines[0].url;
        let dataJSONProperties = _repeater.lines[0].url_data_properties.split(",");
        let dataJSONPropertyToShow = gaugeSettings.property.repeaterDataPropertyToShow;
        let dataJSONTags = {};
        Object.values(gaugeSettings.property.repeaterDataSource).forEach(val => {
            if (val['repeaterDataId']) {
                if (val['repeaterDataId']!=='') {
                    dataJSONTags[val['repeaterDataId']] = val['id'];
                }
            }
        });
        let view = gaugeSettings.property.view;
        var doc = new DOMParser();
        if (ele) {
            let svgDivContainer = Utils.searchTreeStartWith(ele, this.prefixD);
            while (svgDivContainer.firstChild) {
                svgDivContainer.removeChild(svgDivContainer.lastChild);
            }
            svgDivContainer.style['overflow'] = 'auto';
            var divReader = document.createElement("div");
            divReader.style.display = "table"
            divReader.style.width = "100%";
            divReader.id= "reader";
            svgDivContainer.appendChild(divReader); 
            
            var divInput = document.createElement("div");
            divInput.style.display = "table"
            divInput.style.width = "100%";
            svgDivContainer.appendChild(divInput);         
            
            var input = document.createElement("input");
            input.type ="text";
            input.id = "repeater_html5_qrcode_input";
            input.setAttribute("onblur", "onChangeInput()");
            divInput.appendChild(input);         
            var divReaderStartButtonStart = document.createElement("button");
            divReaderStartButtonStart.id = "repeater_html5_qrcode_start";
            divReaderStartButtonStart.setAttribute('content', 'QR Code Start');
            divReaderStartButtonStart.setAttribute('class', 'repeater-html5-qrcode-start');  
            divReaderStartButtonStart.textContent = 'QR Code Start';
            divInput.appendChild(divReaderStartButtonStart);
            var divReaderStartButtonStop = document.createElement("button");
            divReaderStartButtonStop.id = "repeater_html5_qrcode_stop";
            divReaderStartButtonStop.setAttribute('content', 'QR Code Stop');
            divReaderStartButtonStop.setAttribute('class', 'repeater-html5-qrcode-stop');  
            divReaderStartButtonStop.textContent = 'QR Code Stop';
            divInput.appendChild(divReaderStartButtonStop);

            var divInputSearch = document.createElement("div");
            divInputSearch.style.display = "table"
            divInputSearch.style.width = "100%";
            svgDivContainer.appendChild(divInputSearch);         
            var divReaderSearch = document.createElement("button");
            divReaderSearch.id = "repeater_input_search";
            divReaderSearch.setAttribute('content', '...');
            divReaderSearch.setAttribute('class', 'repeater-input-search');  
            divReaderSearch.style.width = "100%";
            divReaderSearch.textContent = '...';
            divInputSearch.appendChild(divReaderSearch);

            let v: View = this.getView(hmiService, view);
            this.viewObjectsScripts = {};
            Object.entries(v.items).forEach(entry => {
                try {
                    for(let e =0; e < entry[1]['property']['events'].length; e++) {
                        this.viewObjectsScripts[entry[1]['id'].toLowerCase()] = entry[1]['property']['events'][e]['actparam'];
                    }
                } catch (err) {}
            });
            this.scripts = hmiService.projectService.getScripts();
            EndPointApi.getJSONFromURL(this.endPointConfig + dataJSONURL).subscribe(result => {
                let jsonObj = result;
                Object.entries(jsonObj).forEach(entry => {
                    if (svgDivContainer) {
                        const [key, value] = entry;
                        let prop = [entry, dataJSONProperties];
                        var xml = doc.parseFromString(v.svgcontent, "image/svg+xml");
                        var svgNodes = xml.getElementsByTagName("svg");
                        this.modifyIdsOfElements(svgNodes, prop, dataJSONPropertyToShow, dataJSONTags);
                        svgDivContainer.appendChild(svgNodes[0]);
                    }
                });
                setTimeout(function() {
                    var content = svgDivContainer.innerHTML;
                    svgDivContainer.innerHTML= content;
                }, 1000); 
            } );

        }
        initializeHtml5QrCode(gaugeSettings.id);
        let factory = resolver.resolveComponentFactory(RepeaterComponent);
        const componentRef = viewContainerRef.createComponent(factory);
        return componentRef.instance;
    }

    static getScript = function (scriptsMap, _script) {
        return Object.entries(scriptsMap).find(s => s[1]['id'] === _script);
    }

    static modifyIdsOfElements(node, properties, property, tags) {
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
                _data += properties[1][j] + "|"+ properties[0][1][properties[1][j]];
            }
        }
        if (!flgTagName) {
            _data += "tagName|" + flgTagExist;
        }
        let _id = properties[0][0];
        for(let i = 0; i < node.length; i++)
            if (node[i].nodeType == 1) {
                let _text = properties[0][1][property];
                node[i].setAttribute("data", _data);
                node[i].style.display = "flex";
                this.recurseAndAdd(node[i], _data, _id, _text);
                var divInputHidden = document.createElement("input");
                divInputHidden.id = (tags[_id] ? tags[_id]: "hidden" + _id);
                divInputHidden.setAttribute("type","hidden");
                divInputHidden.style.display = "table"
                divInputHidden.style.width = "100%";
                node[i].appendChild(divInputHidden);   
            }
    }

    static recurseAndAdd(el, _data, _id, _text) {
        var children = el.childNodes;
        for(let i=0; i < children.length; i++) {
            if (children[i].nodeType == 1) {
                if ('id' in children[i]){
                    let id = children[i].id;
                    if (this.viewObjectsScripts.hasOwnProperty(id.toLowerCase())){
                        let scriptEntry = this.getScript(this.scripts, this.viewObjectsScripts[id.toLowerCase()]);
                        let script = scriptEntry[1];
                        if (script['mode'] === 'CLIENT') {
                            children[i].setAttribute("onclick",script['code']);
                        }              
                    }
                    if (children[i].id !== '') {
                        children[i].id = children[i].id + "_" + _id;
                    }
                    children[i].setAttribute("data", _data);
                    if (children[i].tagName.toLowerCase() === "button") {
                        try {
                            children[i].innerHTML = children[i].innerHTML + " " + _text ;
                            if (_data.indexOf("&tagName|&")>=0) {
                                children[i].setAttribute("disabled","true");
                                children[i].style.backgroundColor = "rgb(112,112,112)";
                            }
                        } catch (e) {}
                    }
                }
                this.recurseAndAdd(children[i], _data, _id, _text);
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
                    if (sig.value) {
                        _h.setAttribute("value", sig.value);
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

    static getView(hmiService: HmiService, name: string) {
        for (var i = 0; i < hmiService.hmi.views.length; i++) {
            if (hmiService.hmi.views[i].id === name) {
                return hmiService.hmi.views[i];
            }
        }
        return null;
    }

}
