/* eslint-disable @angular-eslint/component-class-suffix */
import {AfterViewInit, Component, Inject, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subject, Subscription, takeUntil} from 'rxjs';
import {Router} from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatTable, MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { UntypedFormControl } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';

import {DeviceListComponent} from './device-list/device-list.component';
import {DeviceMapComponent} from './device-map/device-map.component';
import {Device, DEVICE_PREFIX, DevicesUtils, DeviceType, DeviceViewModeType, TAG_PREFIX, Tag} from './../_models/device';
import { AlarmProperty, AlarmAckMode, AlarmSubProperty, AlarmSubActions, AlarmAction, AlarmActionsType } from '../_models/alarm';
import {ProjectService} from '../_services/project.service';
import {HmiService} from '../_services/hmi.service';
import {DEVICE_READONLY} from '../_models/hmi';
import {Utils} from '../_helpers/utils';
import { SettingsService } from '../_services/settings.service';
import { SectionMessageDialogComponent } from '../editor/section-message-dialog/section-message-dialog.component';

@Component({
    selector: 'app-device',
    templateUrl: './device.component.html',
    styleUrls: ['./device.component.scss']
})
export class DeviceComponent implements OnInit, OnDestroy {

    @ViewChild('devicelist', {static: false}) deviceList: DeviceListComponent;
    @ViewChild('devicemap', {static: false}) deviceMap: DeviceMapComponent;
    @ViewChild('fileImportInput', {static: false}) fileImportInput: any;
    @ViewChild('tplFileImportInput',{static: false}) tplFileImportInput: any;

    private subscriptionLoad: Subscription;
    private subscriptionDeviceChange: Subscription;
    private subscriptionVariableChange: Subscription;
    private askStatusTimer;
    private destroy$ = new Subject<void>();
    private sectionMessageHandled = false;
    private sectionMessageOpened = false;

    devicesViewMode = DeviceViewModeType.devices;
    devicesViewMap = DeviceViewModeType.map;
    devicesViewList = DeviceViewModeType.list;
    tagsViewMode = DeviceViewModeType.tags;

    showMode = <string>this.devicesViewMap;
    readonly = false;
    reloadActive = false;

    constructor(private router: Router,
        private projectService: ProjectService,
        private hmiService: HmiService,
        private settingsService: SettingsService,
        private dialog: MatDialog) {
        if (this.router.url.indexOf(DEVICE_READONLY) >= 0) {
            this.readonly = true;
        }
        this.showMode = localStorage.getItem('@frango.devicesview') || this.devicesViewMap;
    }

    ngOnInit() {
        this.subscriptionLoad = this.projectService.onLoadHmi.subscribe(res => {
            this.deviceMap.loadCurrentProject();
            this.deviceList.mapTags();
        });
        this.subscriptionDeviceChange = this.hmiService.onDeviceChanged.subscribe(event => {
            this.deviceMap.setDeviceStatus(event);
        });
        this.subscriptionVariableChange = this.hmiService.onVariableChanged.subscribe(event => {
            this.deviceList.updateDeviceValue();
        });
        this.askStatusTimer = setInterval(() => {
            this.hmiService.askDeviceStatus();
        }, 10000);
        this.hmiService.askDeviceStatus();
        this.settingsService.loaded$.pipe(takeUntil(this.destroy$)).subscribe(loaded => {
            if (loaded) {
                this.openPluginsNoticeIfNeeded();
            }
        });
    }

    ngOnDestroy() {
        // this.checkToSave();
        try {
            if (this.subscriptionLoad) {
                this.subscriptionLoad.unsubscribe();
            }
            if (this.subscriptionDeviceChange) {
                this.subscriptionDeviceChange.unsubscribe();
            }
            if (this.subscriptionVariableChange) {
                this.subscriptionVariableChange.unsubscribe();
            }
        } catch (e) {
        }
        try {
            clearInterval(this.askStatusTimer);
            this.askStatusTimer = null;
        } catch { }
        this.destroy$.next();
        this.destroy$.complete();
    }

    show(mode: string) {
        // this.checkToSave();
        this.showMode = mode;
        if (this.showMode === this.tagsViewMode) {
            this.deviceList.updateDeviceValue();
            try {
                if (Object.values(this.deviceMap.devicesValue()).length > 0) {
                    this.deviceList.setSelectedDevice(this.deviceMap.devicesValue()[0]);
                }
            } catch (e) {
            }
        } else {
            localStorage.setItem('@frango.devicesview', this.showMode);
        }
    }

    gotoDevices(flag: boolean) {
        if (flag) {
            if (this.showMode === this.devicesViewMap) {
                this.show(this.devicesViewList);
            } else {
                this.show(this.devicesViewMap);
            }
            return;
        }
        let mode = localStorage.getItem('@frango.devicesview') || this.devicesViewMap;
        this.show(mode);
    }

    gotoList(device: Device) {
        this.onReload();
        this.show(this.tagsViewMode);
        this.deviceList.setSelectedDevice(device);
    }

    addItem() {
        if (this.showMode === this.tagsViewMode) {
            this.deviceList.onAddTag();
        } else if (this.showMode.startsWith(this.devicesViewMode)) {
            this.deviceMap.addDevice();
        }
    }

    onReload() {
        this.projectService.onRefreshProject();
        this.reloadActive = true;
        setTimeout(() => {
            this.reloadActive = false;
        }, 1000);
    }

    onExport(type: string) {
        try {
            this.projectService.exportDevices(type);
        } catch (err) {
            console.error(err);
        }
    }

    onImport() {
        let ele = document.getElementById('devicesConfigFileUpload') as HTMLElement;
        ele.click();
    }

    onImportTpl() {
        let ele = document.getElementById('devicesConfigTplUpload') as HTMLElement;
        ele.click();
    }

    onCreateAlarms() {
        let _entries = [];
        try {
            Object.entries(this.projectService.getDevices()).forEach(entry => {
                if (entry[0] === this.deviceList.deviceSelected.id) {
                    _entries.push(entry[1]['tags']);
                }
            });
        } catch (err) {
            console.error(err);
        } finally {
            let dialogRef = this.dialog.open(DeviceAlarmDialog, {
                position: { top: '60px' },
                data:  _entries
            });
    
            dialogRef.afterClosed().subscribe((result) => {
                try {
                    if (result) {
                        let _tags = result[0];
                        let _alarm = result["alarm"];
                        Object.values(_tags).forEach( (val:any) => {
                            let _tmp = { ..._alarm };
                            _tmp.property = result.property;
                            _tmp.property.variableId = val.id;
                            _tmp.property.variableValueIsObject = result.variableValueIsObject;
                            _tmp.property.variableValueObjectProperty = result.variableValueObjectProperty;
                            _tmp.name = val.id + " [" + val.name + "]";
                            this.projectService.setAlarm(_tmp, null).subscribe(result => {
                                console.log(result);
                            });
                        });
                    }
                } catch (e) {}
            });
        }  
    }

    /**
     * @deprecated use onDevTplChangeListener
     * open Project event file loaded
     * @param event file resource
     */
    onFileChangeListener(event) {
        return this.onDevTplChangeListener(event, false);
    }

    /**
     * open Project event file loaded
     * @param event file resource
     * @param isTemplate use template for import, if true, generate new device id and tag id
     */
    onDevTplChangeListener(event, isTemplate: boolean){
        let input = event.target as HTMLInputElement;
        let reader = new FileReader();
        reader.onload = (data) => {
            let devices;
            if (Utils.isJson(reader.result)) {
                // JSON
                devices = JSON.parse(reader.result.toString());
            } else {
                // CSV
                devices = DevicesUtils.csvToDevices(reader.result.toString(), this.projectService.getScripts());
            }
            //generate new id and filte fuxa
            let importDev = [];
            if(isTemplate) {
                devices.forEach((device: Device) => {
                    if (device.type != DeviceType.FuxaServer) {
                        device.id = Utils.getGUID(DEVICE_PREFIX);
                        device.name = Utils.getShortGUID(device.name + '_', '');
                        if (device.tags) {
                            let newTags = {};
                            Object.keys(device.tags).forEach((key) => {
                                const id = Utils.getGUID(TAG_PREFIX);
                                //change tags key to new id
                                newTags[id] = device.tags[key];
                                newTags[id].id = id;
                            });
                            device.tags = newTags;
                        }
                        importDev.push(device);
                    }
                });
            }
            this.projectService.importDevices(isTemplate ? importDev : devices);
            setTimeout(() => { this.projectService.onRefreshProject(); }, 2000);
        };

        reader.onerror = function() {
            let msg = 'Unable to read ' + input.files[0];
            // this.translateService.get('msg.project-load-error', {value: input.files[0]}).subscribe((txt: string) => { msg = txt });
            alert(msg);
        };
        reader.readAsText(input.files[0]);
        if (input) {
            input.value = '';
        }
    }

    private openPluginsNoticeIfNeeded() {
        if (this.readonly || this.sectionMessageHandled || this.sectionMessageOpened ||
            this.settingsService.getSettings()?.editorSectionMessages?.hideDevicePluginsNotice) {
            this.sectionMessageHandled = true;
            return;
        }

        this.sectionMessageOpened = true;
        const dialogRef = this.dialog.open(SectionMessageDialogComponent, {
            autoFocus: false,
            width: '560px',
            panelClass: 'light-dialog-container',
            data: {
                titleKey: 'device.plugins-notice-title',
                messageKey: 'device.plugins-notice-message',
                hideLabelKey: 'device.plugins-notice-hide',
                actionLabelKey: 'device.plugins-notice-open',
                routePath: '/plugins',
                absoluteUrl: `${window.location.origin}/plugins`,
                settingKey: 'hideDevicePluginsNotice'
            }
        });

        dialogRef.afterClosed().subscribe(() => {
            this.sectionMessageOpened = false;
            this.sectionMessageHandled = true;
        });
    }
}

@Component({
    selector: 'device-tag-dialog',
    templateUrl: './device-tag.dialog.html',
    styleUrls: ['./device.component.scss']
})
export class DeviceTagDialog implements OnInit, AfterViewInit {

    @ViewChild(MatTable, {static: false}) table: MatTable<any>;
    @ViewChild(MatSort, {static: false}) sort: MatSort;
    @ViewChild(MatPaginator, {static: false}) paginator: MatPaginator;

    dataSource = new MatTableDataSource([]);
    nameFilter = new UntypedFormControl();
    addressFilter = new UntypedFormControl();
    deviceFilter = new UntypedFormControl();
    tags: TagElement[] = [];

    filteredValues = {
        name: '', address: '', device: ''
    };

    readonly defColumns = ['toogle', 'name', 'address', 'device', 'select'];

    constructor(public dialogRef: MatDialogRef<DeviceTagDialog>,
        @Inject(MAT_DIALOG_DATA) public data: any) {
        if (this.data.devices) {
            this.data.devices.forEach((device: Device) => {
                if (data.deviceFilter && data.deviceFilter.indexOf(device.type) !== -1) {
                    // filtered device
                } else if (device.tags) {
                    Object.values(device.tags).forEach((t: Tag) => this.tags.push(<TagElement> {
                            id: t.id, name: t.name, address: t.address,
                            device: device.name, checked: (t.id === this.data.variableId), error: null
                        }
                    ));
                }
            }
            );
        }
        this.dataSource = new MatTableDataSource(this.tags);
    }

    ngOnInit() {

        this.nameFilter.valueChanges.subscribe((nameFilterValue) => {
            this.filteredValues['name'] = nameFilterValue;
            this.dataSource.filter = JSON.stringify(this.filteredValues);
        });

        this.addressFilter.valueChanges.subscribe((addressFilterValue) => {
            this.filteredValues['address'] = addressFilterValue;
            this.dataSource.filter = JSON.stringify(this.filteredValues);
        });

        this.deviceFilter.valueChanges.subscribe((deviceFilterValue) => {
            this.filteredValues['device'] = deviceFilterValue;
            this.dataSource.filter = JSON.stringify(this.filteredValues);
        });
        this.dataSource.filterPredicate = this.customFilterPredicate();
    }

    customFilterPredicate() {
        const myFilterPredicate = (data: TagElement, filter: string): boolean => {
            let searchString = JSON.parse(filter);
            return (!data.name || data.name.toString().trim().toLowerCase().indexOf(searchString.name.toLowerCase()) !== -1) &&
                (!data.address || data.address.toString().trim().toLowerCase().indexOf(searchString.address.toLowerCase()) !== -1) &&
                data.device.toString().trim().toLowerCase().indexOf(searchString.device.toLowerCase()) !== -1;
        };
        return myFilterPredicate;
    }

    ngAfterViewInit() {
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
        // this.dataSource.data = this.data.tags;
    }

    onToogle(element: TagElement) {
        if (element.checked && !this.data.multiSelection) {
            this.dataSource.data.forEach(e => {
                if (e.id !== element.id) {
                    e.checked = false;
                }
            });
        }
    }

    onClearSelection() {
        this.dataSource.data.forEach(e => {
            e.checked = false;
        });
    }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        if (this.filteredValues.name === "tagName") {
            this.data.variableId = this.filteredValues.name;
            this.data.variableValue = this.filteredValues.address;
            this.data.variablesId = [];
            this.data.variablesId.push(this.data.variableId);
        } else {
            this.data.variableId = null;
            this.data.variableValue = null;
            this.data.variablesId = [];
            this.dataSource.data.forEach(e => {
                if (e.checked) {
                    this.data.variableId = e.id;
                    this.data.variablesId.push(e.id);
                }
            });
        }
        this.dialogRef.close(this.data);
    }

    onSelect(element: TagElement) {
        this.data.variableId = element.id;
        this.dialogRef.close(this.data);
    }
}

@Component({
    selector: 'device-alarm-dialog',
    templateUrl: './device-alarm.dialog.html',
    styleUrls: ['../alarms/alarm-property/alarm-property.component.scss']
})
export class DeviceAlarmDialog {

    property: AlarmProperty;
    ackMode = AlarmAckMode;
    actionsType = AlarmActionsType;
    actionPopup = Object.keys(AlarmActionsType).find(key => AlarmActionsType[key] === AlarmActionsType.popup);
    actionSetView = Object.keys(AlarmActionsType).find(key => AlarmActionsType[key] === AlarmActionsType.setView);
    actionSetValue = Object.keys(AlarmActionsType).find(key => AlarmActionsType[key] === AlarmActionsType.setValue);
    // actionSendMsg = Object.keys(AlarmActionsType).find(key => AlarmActionsType[key] === AlarmActionsType.sendMsg);

    errorExist = false;
    errorMissingValue = false;
    existnames = [];
    existtexts = [];
    existgroups = [];

    constructor(
        private translateService: TranslateService,
        public dialogRef: MatDialogRef<DeviceAlarmDialog>,
        @Inject(MAT_DIALOG_DATA) public data: any) {
            this.property = new AlarmProperty();
            this.data.alarm = {};
            this.data.alarm.highhigh = new AlarmSubProperty();
            this.data.alarm.highhigh.bkcolor = '#FF4848';
            this.data.alarm.highhigh.color = '#FFF';
            this.data.alarm.highhigh.enabled = false;
            this.data.alarm.highhigh.ackmode = <AlarmAckMode>Object.keys(AlarmAckMode)[Object.values(AlarmAckMode).indexOf(AlarmAckMode.ackactive)];
            this.data.alarm.high = new AlarmSubProperty();
            this.data.alarm.high.bkcolor = '#F9CF59';
            this.data.alarm.high.color = '#000';
            this.data.alarm.high.enabled = false;
            this.data.alarm.high.ackmode = <AlarmAckMode>Object.keys(AlarmAckMode)[Object.values(AlarmAckMode).indexOf(AlarmAckMode.ackactive)];
            this.data.alarm.low = new AlarmSubProperty();
            this.data.alarm.low.bkcolor = '#E5E5E5';
            this.data.alarm.low.color = '#000';
            this.data.alarm.low.enabled = false;
            this.data.alarm.low.ackmode = <AlarmAckMode>Object.keys(AlarmAckMode)[Object.values(AlarmAckMode).indexOf(AlarmAckMode.ackactive)];
            this.data.alarm.info = new AlarmSubProperty();
            this.data.alarm.info.bkcolor = '#22A7F2';
            this.data.alarm.info.color = '#FFF';
            this.data.alarm.info.enabled = false;
            this.data.alarm.info.ackmode = <AlarmAckMode>Object.keys(AlarmAckMode)[Object.values(AlarmAckMode).indexOf(AlarmAckMode.float)];
            this.data.alarm.actions = new AlarmSubActions();
            this.data.alarm.actions.enabled = false;
            Object.keys(this.ackMode).forEach(key => {
                this.translateService.get(this.ackMode[key]).subscribe((txt: string) => { this.ackMode[key] = txt; });
            });
            Object.keys(this.actionsType).forEach(key => {
                this.translateService.get(this.actionsType[key]).subscribe((txt: string) => { this.actionsType[key] = txt; });
            });
        }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        this.data.property = this.property;
        this.dialogRef.close(this.data);
    }
}

export interface TagElement {
    id: string;
    name: string;
    address: string;
    device: string;
    checked: boolean;
    error: string;
}
