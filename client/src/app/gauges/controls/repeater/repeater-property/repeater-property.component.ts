import { Component, Inject, EventEmitter, OnInit, Input, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTable, MatTableDataSource } from '@angular/material/table';
import { ReplaySubject } from 'rxjs';
import { UntypedFormControl } from '@angular/forms';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

import { TranslateService } from '@ngx-translate/core';
import { RepeaterProperty } from '../../../../_models/hmi';
import { RepeaterData } from '../../../../_models/repeater';
import { ProjectService } from '../../../../_services/project.service';
import { HmiService } from '../../../../_services/hmi.service';
import { EndPointApi } from '../../../../_helpers/endpointapi';
import { RepeaterConfigComponent, IDataRepeaterDataResult } from '../../../../editor/repeater-config/repeater-config.component';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
    selector: 'app-repeater-property',
    templateUrl: './repeater-property.component.html',
    styleUrls: ['./repeater-property.component.css']
})
export class RepeaterPropertyComponent implements OnInit {

    @Input() data: any;
    @Output() onPropChanged: EventEmitter<any> = new EventEmitter();
    @Input('reload') set reload(b: any) {
        this._reload();
    }

    public repeaterDataCtrl: UntypedFormControl = new UntypedFormControl();
    public repeaterDataFilterCtrl: UntypedFormControl = new UntypedFormControl();
    public filteredRepeaterData: ReplaySubject<RepeaterData[]> = new ReplaySubject<RepeaterData[]>(1);
    property: RepeaterProperty;

    private _onDestroy = new Subject<void>();

    constructor(
        public dialog: MatDialog,
        private translateService: TranslateService) {
    }

    ngOnInit() {
        this._reload();
    }

    onPropertyChanged() {
        this.onPropChanged.emit(this.data.settings);
    }

    private _reload() {
        if (!this.data.settings.property) {
            this.data.settings.property = { repeaterData: null, repeaterDataPropertyToShow: null, view: null, dataSource: null };
        }
        this.property = this.data.settings.property;
        this.loadRepeaterData();
        let repeater = null;
        if (this.data.repeaters) {
            repeater = this.data.repeaters.find(_r => _r.id === this.data.settings.property.repeaterData);
        }
        this.repeaterDataCtrl.setValue(repeater);
    }

    onRepeaterDataChanged() {
        if (!this.data.settings.property) {
            this.data.settings.property = { repeaterData: null, repeaterDataPropertyToShow: null, view: null, dataSource: null };
        }
        if (this.repeaterDataCtrl.value) {
            this.data.settings.property.repeaterData = this.repeaterDataCtrl.value.id;
        }
        this.onPropChanged.emit(this.data.settings);
    }

    onEditNewRepeaterData() {
        let dialogRef = this.dialog.open(RepeaterConfigComponent, {
            position: { top: '60px' },
            minWidth: '1090px', width: '1090px'
        });
        dialogRef.afterClosed().subscribe((result: IDataRepeaterDataResult) => {
            if (result) {
                this.data.repeaters = result.repeaters;
                this.loadRepeaterData();
                if (result.selected) {
                    this.repeaterDataCtrl.setValue(result.selected);
                }
                this.onRepeaterDataChanged();
            }
        });
    }

    private loadRepeaterData(toset?: string) {
        // load the initial repeater data list
        this.filteredRepeaterData.next(this.data.repeaters.slice());
        // listen for search field value changes
        this.repeaterDataFilterCtrl.valueChanges
            .pipe(takeUntil(this._onDestroy))
            .subscribe(() => {
                this.filterRepeaterData();
            });
        if (toset) {
            let idx = -1;
            this.data.repeaters.every(function(value, index, _arr) {
                if (value.id === toset) {
                    idx = index;
                    return false;
                }
                return true;
            });
            if (idx >= 0) {
                this.repeaterDataCtrl.setValue(this.data.repeaters[idx]);
            }
        }
    }

    private filterRepeaterData() {
        if (!this.data.repeaters) {
            return;
        }
        // get the search keyword
        let search = this.repeaterDataFilterCtrl.value;
        if (!search) {
            this.filteredRepeaterData.next(this.data.repeaters.slice());
            return;
        } else {
            search = search.toLowerCase();
        }
        // filter the variable
        this.filteredRepeaterData.next(
            this.data.repeaters.filter(repeaterData => repeaterData.name.toLowerCase().indexOf(search) > -1)
        );
    }

    openTagsToRepeaterData() {
        let dialogRef = this.dialog.open(DialogTagRepeater, {
            data: this.data,
            position: { top: '60px' },
            minWidth: '850px', width: '850px', height: '500px'
        });
        dialogRef.afterClosed().subscribe((result: any) => {
            if (result) {
                this.data.settings.property['repeaterDataSource'] = result.settings.property.repeaterDataSource;
                this.property.repeaterDataSource = result.settings.property.repeaterDataSource;
                this.onPropChanged.emit(this.data.settings);
            }
        });
    }
}

@Component({
    selector: 'tag-repeater-matching',
    templateUrl: './tag-repeater.dialog.html',
    styleUrls: ['./repeater-property.component.css']
})
export class DialogTagRepeater implements OnInit {
    readonly defAllColumns = ['tag', 'repeaterDataId', 'input', 'repeaterdDataSearch', 'search', 'clear'];
    readonly defAllRowWidth = 800;

    endPointConfig: string = EndPointApi.getURL();
    repeaterDataSource = new MatTableDataSource([]);
    @Input() readonly = false;
    displayedColumns = this.defAllColumns;
    tableWidth = this.defAllRowWidth;
    search = {};
    search_result = {};
    dataJSONURL: string;
    dataJSONProperties: string[];
    dataJSON = [];
    tags = {};

    constructor(
        public dialogRef: MatDialogRef<DialogTagRepeater>,
        private projectService: ProjectService,
        private hmiService: HmiService,
        @Inject(MAT_DIALOG_DATA) public data: any) {
    }

    ngOnInit() {
        let _devices = this.projectService.getDevices();
        Object.values(_devices).forEach((d:any) => {
            if (d.tags) {
                Object.values(d.tags).forEach((t: any) => {
                    this.tags[t.id] = t.name;
                    this.repeaterDataSource.data.push({id: t.id, repeaterDataId: this.getRepeaterDataId(t.id)});
                });
            }
        });        
        let _repeater:any = Object.values(this.data.repeaters).find((e:any) => e.id === this.data.settings.property.repeaterData);
        this.dataJSONURL = _repeater.lines[0].url;
        this.dataJSONProperties = _repeater.lines[0].url_data_properties.split(",");

        EndPointApi.getJSONFromURL(this.endPointConfig + this.dataJSONURL).subscribe(result => {
            this.dataJSON = result;
        });
    }
    
    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        Object.entries(this.repeaterDataSource.data).forEach((entry:any) => {
            if (this.search_result[entry[1].id]){
                if (this.search_result[entry[1].id]!=='')
                    this.repeaterDataSource.data[entry[0]]["repeaterDataId"] = this.search_result[entry[1].id][this.dataJSONProperties[0]];
            }
        });
        this.data.settings.property['repeaterDataSource'] = this.repeaterDataSource.data;
        this.dialogRef.close(this.data);
    }

    onClear(element: any) : void{
        this.search_result[element.id] = {};
        Object.entries(this.repeaterDataSource.data).forEach((entry:any) => {
            if (entry[1]['id']===element.id)
                this.repeaterDataSource.data[entry[0]]["repeaterDataId"] = '';
        });
    }

    onSearch(element: any): void {
        if (this.search) {
            if (this.search[element.id]) {
                this.search_result[element.id] = {};
                Object.values(this.dataJSON).every( (e:any) =>{
                    if (e.nume.indexOf(this.search[element.id])>0 || e.nume===this.search[element.id]) {
                        this.search_result[element.id] = e;
                        return false;
                    }
                    return true;
                }); 
            }
        }
    }

    getSearchResult(element: any): string {
        let _res = '';
        if (this.search_result) {
            if (this.search_result[element]) {
                Object.values(this.dataJSONProperties).forEach( val => {
                    if (this.search_result[element][val]) {
                        _res += this.search_result[element][val] + ' ';
                    }
                });
            }
        }
        return _res;
    }

    getRepeaterDataId(id: any): string {
        let _res = '';
        try {
            _res = Object.values(this.data.settings.property.repeaterDataSource).find((e:any)=>e.id===id)['repeaterDataId'].toString();
        } catch (e) {
            console.log(e);
        }
        return _res;
    }
}


