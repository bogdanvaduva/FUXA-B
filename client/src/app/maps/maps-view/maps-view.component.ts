import { AfterViewInit, ApplicationRef, Component, ComponentFactoryResolver, ElementRef, EventEmitter, Injector, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { GaugesManager } from '../../gauges/gauges.component';
import { FuxaViewComponent } from '../../fuxa-view/fuxa-view.component';
import { ProjectService } from '../../_services/project.service';
import { MatMenuTrigger as MatMenuTrigger } from '@angular/material/menu';
import { MatDialog as MatDialog } from '@angular/material/dialog';
import { GaugeAction, GaugeRangeProperty, Hmi, View, ViewProperty } from '../../_models/hmi';
import { filter, Subject, takeUntil } from 'rxjs';
import { MapsLocation, MapsLocationSourceType, MAPSLOCATION_PREFIX } from '../../_models/maps';
import { RepeaterUtils } from '../../_models/repeater';
import { RepeaterComponent } from '../../gauges/controls/repeater/repeater.component';
import { MapsLocationPropertyComponent, MapsLocationPropertyData, MapsLocationPropertyResult } from '../maps-location-property/maps-location-property.component';
import { Utils } from '../../_helpers/utils';
import { TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { MapsLocationImportComponent } from '../maps-location-import/maps-location-import.component';
import { MapsFabButtonMenuComponent } from './maps-fab-button-menu/maps-fab-button-menu.component';
import { HmiService } from '../../_services/hmi.service';

interface MarkerBinding {
    /** value elements of the markers bound to the tag, owner is the location id */
    nodes: { id: string; owner: string }[];
    domNodes: HTMLElement[];
    actions: {
        action: GaugeAction;
        marker: L.Marker;
        element?: HTMLElement | null;
        owner: string;
    }[];
};

/** a marker of a location: the static position or an item of the Repeater data of a dynamic location */
interface MarkerPoint {
    latitude: number;
    longitude: number;
    name: string;
    tagId?: string;
    /** dynamic: the item and its key in the Repeater data */
    item?: any;
    key?: string;
}

@Component({
    selector: 'app-maps-view',
    templateUrl: './maps-view.component.html',
    styleUrls: ['./maps-view.component.scss']
})
export class MapsViewComponent implements AfterViewInit, OnDestroy {

    @Input() view: View;
    @Input() hmi: Hmi;
    @Input() gaugesManager: GaugesManager;        // gauges.component
    @Input() editMode: boolean;
    @Output() onGoTo: EventEmitter<string> = new EventEmitter<string>();

    @ViewChild(MatMenuTrigger) menuTrigger!: MatMenuTrigger;
    @ViewChild('menuTrigger', { read: ElementRef }) menuTriggerButton!: ElementRef;

    @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef;
    private map: L.Map | null = null;

    private destroy$ = new Subject<void>();
    lastClickLatLng!: L.LatLng;
    lastClickMarker?: L.Marker;

    menuPosition = { x: '0px', y: '0px' };
    private locations: MapsLocation[] = [];
    lastClickMapLocation?: MapsLocation;
    private markerItemsMap = new Map<string, MarkerBinding>();
    /** markers of every location (id), a dynamic location has one marker per item */
    private markersByLocation = new Map<string, L.Marker[]>();
    private dynamicTimers: any[] = [];
    /** incremented on every load, the data of a previous load is ignored */
    private loadToken = 0;

    private openPopups = [];
    private currentPopup: L.Popup | null = null;

    constructor(
        private resolver: ComponentFactoryResolver,
        private hmiService: HmiService,
        private injector: Injector,
        private dialog: MatDialog,
        private projectService: ProjectService,
        private appRef: ApplicationRef,
        private translateService: TranslateService,
        private toastr: ToastrService
    ) { }

    ngAfterViewInit(): void {
        let startLocation: L.LatLngExpression = [46.9466746335407, 7.444236656153662]; // Bern
        if (this.view.property?.startLocation) {
            startLocation = [this.view.property.startLocation.latitude, this.view.property.startLocation.longitude];
        }

        setTimeout(() => {
            this.map = L.map('map').setView(startLocation, this.view.property?.startZoom || 13);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; FUXA'
            }).addTo(this.map);

            this.loadMapsResources();
            this.projectService.onLoadHmi.pipe(
                takeUntil(this.destroy$),
            ).subscribe(_ => {
                this.loadMapsResources();
            });

            this.initMapEvents();
            this.map.invalidateSize();

            if (!this.editMode) {
                this.initWatch();
            }
            try {
                this.gaugesManager.emitBindedSignals(this.view.id);
            } catch (err) {
                console.error(err);
            }
        }, 200);
    }

    ngOnDestroy() {
        this.clearDynamicTimers();
        this.destroy$.next(null);
        this.destroy$.complete();
    }

    reload() {
        this.loadMapsResources();
    }

    initMapEvents() {
        this.map.on('contextmenu', (event: L.LeafletMouseEvent) => {
            this.showContextMenu(event);
        });
        this.map.on('click', () => {
            this.menuTrigger.closeMenu();
        });
    }

    loadMapsResources() {
        this.hmi = this.projectService.getHmi();
        this.locations = this.view?.svgcontent ? this.projectService.getMapsLocations(JSON.parse(this.view.svgcontent)) : [];
        this.clearMarker();
        this.clearDynamicTimers();
        const token = ++this.loadToken;
        this.locations.forEach(loc => {
            if (loc.sourceType === MapsLocationSourceType.dynamic) {
                this.loadDynamicLocation(loc, token);
                if (loc.refreshInterval > 0) {
                    this.dynamicTimers.push(setInterval(() => this.loadDynamicLocation(loc, token), loc.refreshInterval * 1000));
                }
            } else {
                this.addMarker(loc, {
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    name: loc.name,
                    tagId: loc.markerTagValueId
                });
            }
        });
        this.map.off('popupopen').off('popupclose');
        this.map.on('popupopen', (e) => {
            this.openPopups.push(e.popup);
        });
        this.map.on('popupclose', (e) => {
            const index = this.openPopups.indexOf(e.popup);
            if (index > -1) {
                this.openPopups.splice(index, 1);
            }
            e.popup = null;
        });
        if (!this.editMode) {
            this.subscribeMarkerTags();
        }
    }

    /** add the marker of a location at the point, with its value and actions bound to the point tag */
    private addMarker(loc: MapsLocation, point: MarkerPoint): L.Marker {
        const valueHtmlId = Utils.getShortGUID('m_');
        const color = loc.markerColor ?? '#000000';
        const background = loc.markerBackground ?? '#ffffff';
        const icon = loc.markerIcon ? loc.markerIcon : '';
        const image = loc.markerImage ? loc.markerImage : '';
        const nameHtml = loc.showMarkerName
                            ? `<div class="bubble-text"
                                    style="color: var(--bubble-fg);">${Utils.escapeHtml(point.name ?? '')}</div>`
                            : '';
        const iconHtml = loc.showMarkerIcon
                            ? image
                                ? `<img class="bubble-image" src="${image}" alt="">`
                                : `<span class="material-icons bubble-icon"
                                        style="color: var(--bubble-fg);">${icon}</span>`
                            : '';
        const valueHtml = point.tagId && loc.showMarkerValue
                            ? `<div class="bubble-value" id="${valueHtmlId}">${Utils.escapeHtml(this.getCurrentValue(point) ?? '##.##')}</div>`
                            : '';
        const markerHtml = `
        <div class="fuxa-bubble-marker"
             style="--bubble-color:${color};
                    --bubble-bg:${background};
                    --bubble-fg:${color};">

            <div class="bubble-content bubble-column">
                ${iconHtml}
                ${nameHtml}
                ${valueHtml}
            </div>
        </div>`;
        const marker = L.marker([point.latitude, point.longitude], {
            icon: L.divIcon({
                className: 'fuxa-bubble-icon',
                html: markerHtml,
                iconSize: undefined,  // lasciamo che si adatti
                iconAnchor: [0, 0]    // correggiamo via CSS con transform
            })
        }).addTo(this.map);
        marker['locationId'] = loc.id;
        marker['mapPoint'] = point;
        if (!iconHtml && !valueHtml && !nameHtml) {
            this.openMarkerTooltip(marker, point.name);
            marker.setIcon(this.defaultIcon());
        } else if (valueHtml) {
            this.addMarkerItemId(point.tagId!, valueHtmlId, loc.id);
        }
        marker.on('click', () => {
            this.onClickMarker(loc, marker);
        });
        marker.on('contextmenu', (event) => {
            this.showContextMenu(event, marker);
        });
        this.collectActionTags(loc.actions, marker, loc.id, point);
        if (!this.markersByLocation.has(loc.id)) {
            this.markersByLocation.set(loc.id, []);
        }
        this.markersByLocation.get(loc.id).push(marker);
        return marker;
    }

    private defaultIcon(): L.Icon {
        return L.icon({
            iconUrl: 'assets/images/marker-icon.png',
            shadowUrl: 'assets/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 45],
            popupAnchor: [0, -34]
        });
    }

    /**
     * FUXA-B: one marker for every item of the Repeater data of the location, at the latitude/longitude fields
     * of the item, with the name and the tag of the item (value and actions)
     */
    private loadDynamicLocation(loc: MapsLocation, token: number) {
        const repeater = this.projectService.getRepeater(loc.repeaterData);
        const line = repeater?.lines?.[0];
        if (!line) {
            return;
        }
        RepeaterUtils.getItems(line, repeater.id).subscribe({
            next: items => {
                if (token !== this.loadToken || !this.map) {
                    return;
                }
                this.removeLocationMarkers(loc.id);
                Object.entries(items || {}).forEach(([key, item]) => {
                    const latitude = Number(RepeaterUtils.decodeJson(RepeaterUtils.getField(item, loc.latitudeField)));
                    const longitude = Number(RepeaterUtils.decodeJson(RepeaterUtils.getField(item, loc.longitudeField)));
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                        return;
                    }
                    const name = RepeaterComponent.fieldText(RepeaterUtils.getField(item, loc.nameField)) || loc.name;
                    const tagId = this.resolveTagId(RepeaterUtils.getField(item, loc.tagField));
                    this.addMarker(loc, { latitude, longitude, name, tagId, item, key });
                });
                if (!this.editMode) {
                    this.subscribeMarkerTags();
                }
            },
            error: err => console.error(`Maps: cannot load the data of the location ${loc.name}`, err)
        });
    }

    /** tag id of an item field: a tag entry ({ id, value }), a tag id or a tag name */
    private resolveTagId(value: any): string {
        value = RepeaterUtils.decodeJson(value);
        if (RepeaterUtils.isTagEntry(value)) {
            return value.id;
        }
        if (typeof value !== 'string' || !value) {
            return null;
        }
        const tags = Object.values(this.projectService.getDevices() || {}).flatMap((device: any) => Object.values(device.tags || {})) as any[];
        return (tags.find(tag => tag.id === value) || tags.find(tag => tag.name === value))?.id ?? null;
    }

    /** current value of the tag of the point (the item tag entry value until a live value arrives) */
    private getCurrentValue(point: MarkerPoint): any {
        const variable = point.tagId ? this.hmiService.variables?.[point.tagId] : null;
        if (variable && variable.value !== undefined && variable.value !== null) {
            return variable.value;
        }
        if (point.item) {
            const entry = Object.values(point.item).map(v => RepeaterUtils.decodeJson(v)).find(v => RepeaterUtils.isTagEntry(v) && v.id === point.tagId);
            return entry?.value ?? null;
        }
        return null;
    }

    /** remove the markers of a location (e.g. to show the reloaded data of a dynamic location) */
    private removeLocationMarkers(locationId: string) {
        (this.markersByLocation.get(locationId) || []).forEach(marker => this.map.removeLayer(marker));
        this.markersByLocation.delete(locationId);
        this.markerItemsMap.forEach((binding, tagId) => {
            binding.nodes = binding.nodes.filter(node => node.owner !== locationId);
            binding.actions = binding.actions.filter(action => action.owner !== locationId);
            binding.domNodes = [];
            if (!binding.nodes.length && !binding.actions.length) {
                this.markerItemsMap.delete(tagId);
            }
        });
    }

    private clearDynamicTimers() {
        this.dynamicTimers.forEach(timer => clearInterval(timer));
        this.dynamicTimers = [];
    }

    initWatch() {
        this.gaugesManager.onchange.pipe(
            takeUntil(this.destroy$),
            filter(varTag => this.markerItemsMap.has(varTag.id))
        ).subscribe(varTag => {
            this.processValueInMarkerItem(varTag.id, varTag.value);
        });
    }

    private processValueInMarkerItem(tagId: string, newValue: any) {

        const entry = this.markerItemsMap.get(tagId);
        if (!entry) return;

        if (entry.domNodes.length !== entry.nodes.length) {
            entry.domNodes = entry.nodes
                .map(node => document.getElementById(node.id) as HTMLElement)
                .filter(el => !!el);
        }

        if (entry.domNodes.length !== 0) {
            for (const el of entry.domNodes) {
                el.innerText = newValue;
            }
        }
        this.processActions(entry, newValue);
    }

    private addMarkerItemId(variableId: string, nodeId: string, owner: string) {
        if (!this.markerItemsMap.has(variableId)) {
            this.markerItemsMap.set(variableId, { nodes: [], domNodes: [], actions: [] });
        }
        this.markerItemsMap.get(variableId)!.nodes.push({ id: nodeId, owner });
    }

    private openMarkerTooltip(marker: L.Marker, name: string) {
        marker.bindTooltip(Utils.escapeHtml(`${name ?? ''}`), {
            permanent: false,
            direction: 'top',
            offset: [2, -35],
            // className: "marker-label"
        });
    }

    closeAllPopups() {
        this.openPopups.forEach(popup => popup.close());
        this.openPopups.length = 0;
    }

    showContextMenu(event: L.LeafletMouseEvent, marker?: L.Marker): void {
        this.lastClickLatLng = event.latlng;
        this.lastClickMarker = marker;
        const mapContainer = this.map.getContainer().getBoundingClientRect();
        const posX = event.originalEvent.clientX - mapContainer.left;
        const posY = event.originalEvent.clientY - mapContainer.top;
        const triggerButton = this.menuTriggerButton.nativeElement;
        triggerButton.style.left = `${posX}px`;
        triggerButton.style.top = `${posY}px`;
        triggerButton.style.position = 'absolute';
        triggerButton.style.display = 'block';
        this.menuTrigger.openMenu();
    }

    onClickMarker(location: MapsLocation, marker: L.Marker) {
        if (this.currentPopup) {
            this.currentPopup.on('remove', () => {
                this.currentPopup = null;
                this.showPopup(location, marker);
            });
            this.map.closePopup(this.currentPopup);
        } else {
            this.showPopup(location, marker);
        }
    }

    showPopup(location: MapsLocation, marker: L.Marker) {
        this.lastClickMapLocation = location;
        if (!this.isToOpenMenu()) {
            this.createCardPopup(location, marker);
        } else {
            this.showFabButton(location, marker);
        }
    }

    showFabButton(location: MapsLocation, marker: L.Marker) {
        const container = document.createElement('div');
        const factory = this.resolver.resolveComponentFactory(MapsFabButtonMenuComponent);
        const componentRef = factory.create(this.injector);
        this.appRef.attachView(componentRef.hostView);
        container.appendChild((componentRef.hostView as any).rootNodes[0]);
        container.style.width = '40px';
        var buttons = [];
        const point: MarkerPoint = marker?.['mapPoint'];
        if (location.viewId) {
            buttons.push({
                icon: 'chat_bubble_outline', action: () => {
                    this.map.closePopup(this.currentPopup);
                    this.createCardPopup(location, marker);
                }
            });
        }
        if (location.pageId) {
            buttons.push({
                icon: 'arrow_outward', action: () => {
                    this.map.closePopup(this.currentPopup);
                    this.onGoTo?.emit(location.pageId);
                }
            });
        }
        if (location.url) {
            buttons.push({
                icon: 'open_in_new', action: () => {
                    this.map.closePopup(this.currentPopup);
                    window.open(this.getUrl(location, point), '_blank');
                }
            });
        }
        componentRef.instance.buttons = buttons;

        this.currentPopup = L.popup({
            closeButton: false,
            autoClose: false,
            closeOnClick: true,
            offset: L.point(0, 0),
        }).setLatLng(marker.getLatLng())
            .setContent(container)
            .openOn(this.map);
        this.currentPopup.on('remove', () => {
            this.currentPopup = null;
        });
    }

    createCardPopup(location: MapsLocation, marker?: L.Marker) {
        setTimeout(() => {
            const point: MarkerPoint = marker?.['mapPoint'];
            let viewIdToBind = 'map' + location?.viewId + (point?.key !== undefined ? '_' + point.key : '');
            if (!location?.viewId || document.getElementById(viewIdToBind)) {
                return;
            }
            const container = document.createElement('div');
            const factory = this.resolver.resolveComponentFactory(FuxaViewComponent);
            const componentRef = factory.create(this.injector);

            componentRef.instance.gaugesManager = this.gaugesManager;
            componentRef.instance.hmi = this.hmi;
            componentRef.instance.view = this.hmi.views.find(view => view.id === location.viewId);
            componentRef.instance.child = true;
            if (point?.item) {
                // FUXA-B: the item fields as placeholder values of the card ('@name', '@tags.Temperature' bound to the tag)
                componentRef.instance.placeholderValues = RepeaterComponent.getPlaceholderValues(point.item);
            }
            container.setAttribute('id', viewIdToBind);
            this.appRef.attachView(componentRef.hostView);
            container.appendChild((componentRef.hostView as any).rootNodes[0]);

            container.style.width = componentRef.instance.view.profile.width + 'px';

            this.currentPopup = L.popup({
                autoClose: false,
                closeOnClick: false,
                offset: L.point(0, -20)
            }).setLatLng(marker ? marker.getLatLng() : [location.latitude, location.longitude])
                .setContent(container)
                .openOn(this.map);
            this.currentPopup.on('remove', () => {
                this.appRef.detachView(componentRef.hostView);
                componentRef.destroy();
                this.currentPopup = null;
            });
        }, 250);
    }

    onCloseAllPopup() {
        this.closeAllPopups();
    }

    onAddLocation() {
        let location = new MapsLocation(Utils.getGUID(MAPSLOCATION_PREFIX));
        location.latitude = this.lastClickLatLng.lat;
        location.longitude = this.lastClickLatLng.lng;
        this.editLocation(location);
    }

    onEditLocation() {
        var location = this.locations.find(loc => loc.id === this.lastClickMarker['locationId']);
        if (location) {
            this.editLocation(location);
        }
    }

    onRemoveLocation() {
        if (this.lastClickMarker) {
            var locationIndex = this.locations.findIndex(loc => loc.id === this.lastClickMarker['locationId']);
            if (locationIndex !== -1) {
                this.locations.splice(locationIndex, 1);
                this.view.svgcontent = JSON.stringify(this.locations.map(loc => loc.id));
                this.projectService.setViewAsync(this.view).then(() => {
                    this.map.removeLayer(this.lastClickMarker);
                    this.lastClickMarker = null;
                    this.loadMapsResources();
                });
            }
        }
    }

    onSetStartLocation() {
        this.view.property ??= new ViewProperty();
        this.view.property.startLocation = new MapsLocation(Utils.getGUID(MAPSLOCATION_PREFIX));
        this.view.property.startLocation.latitude = this.lastClickLatLng.lat;
        this.view.property.startLocation.longitude = this.lastClickLatLng.lng;
        this.view.property.startZoom = this.map.getZoom();
        this.projectService.setViewAsync(this.view).then(() => {
            this.toastr.success(this.translateService.instant('maps.edit-start-location-saved'));
        });
    }

    onImportLocation() {
        let dialogRef = this.dialog.open(MapsLocationImportComponent, {
            position: { top: '60px' },
            disableClose: true,
            data: this.locations,
        });
        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.insertLocations(result);
            }
        });
    }

    isToOpenMenu(): boolean {
        if (!this.lastClickMapLocation) {
            return false;
        }
        const fields = [this.lastClickMapLocation.pageId, this.lastClickMapLocation.url];
        const definedCount = fields.filter(field => field !== undefined && field !== null && field !== '').length;
        return definedCount >= 1;
    }

    /** URL of the location, '{field}' replaced with the item field of a dynamic location */
    private getUrl(location: MapsLocation, point?: MarkerPoint): string {
        if (!point?.item || !location.url) {
            return location.url;
        }
        return location.url.replace(/\{([^{}]+)\}/g, (match, field) =>
            encodeURIComponent(RepeaterComponent.fieldText(RepeaterUtils.getField(point.item, field.trim()))));
    }

    private clearMarker() {
        this.markerItemsMap.clear();
        this.markersByLocation.clear();
        this.map.eachLayer(layer => {
            if (layer instanceof L.Marker) {
                this.map.removeLayer(layer);
            }
        });
    }

    private editLocation(location?: MapsLocation) {
        let dialogRef = this.dialog.open(MapsLocationPropertyComponent, {
            position: { top: '60px' },
            disableClose: true,
            data: <MapsLocationPropertyData>{ location, mapViewId: this.view.id },
        });
        dialogRef.afterClosed().subscribe((result: MapsLocationPropertyResult) => {
            if (result) {
                this.projectService.setMapsLocation(result.location, location).subscribe(async () => {
                    // the Maps views chosen in the dialog (this one preselected) show the location
                    await this.projectService.setMapsLocationViews(result.location.id, result.mapViewIds);
                    const saved = this.projectService.getViews()?.find(v => v.id === this.view.id);
                    if (saved && saved !== this.view) {
                        this.view.svgcontent = saved.svgcontent;
                    }
                    this.loadMapsResources();
                });
            }
        });
    }

    private insertLocations(location: MapsLocation) {
        this.locations.push(location);
        this.view.svgcontent = JSON.stringify(this.locations.map(loc => loc.id));
        this.projectService.setViewAsync(this.view).then(() => {
            this.loadMapsResources();
        });
    }

    private subscribeMarkerTags() {
        const tagIds = Array.from(this.markerItemsMap.keys());
        if (tagIds.length) {
            this.hmiService.viewsTagsSubscribe(tagIds, true);
        }
    }

    /**
     * bind the actions of the location to their tags. For a marker of a dynamic location an action without tag
     * uses the tag of the item, an action with '@field' the tag of that item field
     */
    private collectActionTags(actions: GaugeAction[] | undefined, marker: L.Marker, owner: string, point: MarkerPoint) {
        if (!actions?.length) {
            return;
        }
        actions.forEach(action => {
            let variableId = action.variableId;
            if (point.item) {
                if (!variableId) {
                    variableId = point.tagId;
                } else if (variableId.startsWith('@')) {
                    variableId = this.resolveTagId(RepeaterUtils.getField(point.item, variableId.substring(1)));
                }
            }
            if (variableId) {
                if (!this.markerItemsMap.has(variableId)) {
                    this.markerItemsMap.set(variableId, { nodes: [], domNodes: [], actions: [] });
                }
                const entry = this.markerItemsMap.get(variableId)!;
                entry.actions.push({
                    action,
                    marker,
                    element: marker.getElement && marker.getElement(),
                    owner
                });
                const current = this.hmiService.variables?.[variableId]?.value;
                if (current !== undefined && current !== null && !this.editMode) {
                    this.processActions({ nodes: [], domNodes: [], actions: [entry.actions[entry.actions.length - 1]] }, current);
                }
            }
        });
    }

    private processActions(binding: MarkerBinding, rawValue: any) {
        if (!binding.actions.length) {
            return;
        }
        const value = this.toNumber(rawValue);
        binding.actions.forEach(actBinding => {
            if (!actBinding.element && actBinding.marker?.getElement) {
                actBinding.element = actBinding.marker.getElement();
            }
            if (!actBinding.element) {
                return;
            }
            const inRange = this.isValueInRange(actBinding.action.range, value);
            switch (actBinding.action.type) {
                case 'show':
                    if (inRange) {
                        this.setMarkerVisibility(actBinding.element, true);
                    }
                    break;
                case 'hide':
                    if (inRange) {
                        this.setMarkerVisibility(actBinding.element, false);
                    }
                    break;
                case 'color':
                    if (inRange) {
                        this.applyMarkerColor(actBinding.element, actBinding.action.options);
                    }
                    break;
                default:
                    break;
            }
        });
    }

    private setMarkerVisibility(element: HTMLElement, visible: boolean) {
        element.style.display = visible ? '' : 'none';
    }

    private applyMarkerColor(element: HTMLElement, options: any) {
        if (!options) {
            return;
        }
        const markerRoot = (element.querySelector('.fuxa-bubble-marker') as HTMLElement) ?? element;
        const target = (element.querySelector('.bubble-content') as HTMLElement)
            ?? markerRoot;

        if (options.fillA) {
            target.style.setProperty('--bubble-bg', options.fillA);
            target.style.backgroundColor = options.fillA;
            target.style.borderRadius = target.style.borderRadius || '12px';
            target.style.overflow = 'hidden';
        }
        if (options.strokeA) {
            markerRoot.style.setProperty('--bubble-color', options.strokeA);
            target.style.setProperty('--bubble-color', options.strokeA);
            target.style.setProperty('--bubble-fg', options.strokeA);
            target.style.color = options.strokeA;
        }
    }

    private isValueInRange(range: GaugeRangeProperty | undefined, value: number | null): boolean {
        if (!range || (range.min === undefined && range.max === undefined)) {
            return true;
        }
        if (value === null) {
            return false;
        }
        const min = range.min ?? -Infinity;
        const max = range.max ?? Infinity;
        return value >= min && value <= max;
    }

    private toNumber(value: any): number | null {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
}
