import { ChangeDetectorRef, Component, Inject, OnInit, ViewChild } from '@angular/core';
import { AbstractControl, UntypedFormBuilder, UntypedFormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA as MAT_DIALOG_DATA, MatDialogRef as MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { ProjectService } from '../../_services/project.service';
import { MapsLocation, MapsLocationSourceType, MAPSLOCATION_PREFIX } from '../../_models/maps';
import { RepeaterData, RepeaterUtils } from '../../_models/repeater';
import { Utils } from '../../_helpers/utils';
import { GaugeAction, GaugeRangeProperty, View, ViewType } from '../../_models/hmi';
import { FlexDeviceTagValueType } from '../../gauges/gauge-property/flex-device-tag/flex-device-tag.component';
import { FlexActionsStandaloneComponent } from '../../gauges/gauge-property/flex-actions-standalone/flex-actions-standalone.component';
import { UploadFile } from '../../_models/project';

@Component({
    selector: 'app-maps-location-property',
    templateUrl: './maps-location-property.component.html',
    styleUrls: ['./maps-location-property.component.scss']
})
export class MapsLocationPropertyComponent implements OnInit {

    location: MapsLocation;
    formGroup: UntypedFormGroup;
    views: View[] = [];
    actions: GaugeAction[] = [];
    defaultColor = Utils.defaultColor;
    sourceType = MapsLocationSourceType;
    repeaters: RepeaterData[] = [];
    /** fields of the items of the selected Repeater data (suggestions for the field inputs) */
    itemFields: string[] = [];
    itemFieldsError = '';
    @ViewChild('flexActionsStandalone', { static: false }) flexActionsStandalone: FlexActionsStandaloneComponent;

    constructor(
        public dialogRef: MatDialogRef<MapsLocationPropertyComponent>,
        private fb: UntypedFormBuilder,
        private translateService: TranslateService,
        private projectService: ProjectService,
        private cdr: ChangeDetectorRef,
        @Inject(MAT_DIALOG_DATA) public data: MapsLocation) {
            this.location = this.data ?? new MapsLocation(Utils.getGUID(MAPSLOCATION_PREFIX));
    }

    ngOnInit() {
        this.views = this.projectService.getViews()?.filter(view => view.type !== ViewType.maps);
        this.repeaters = this.projectService.getRepeaters() || [];
        this.actions = Utils.clone(this.location.actions || []);
        this.formGroup = this.fb.group({
            name: [this.location.name, Validators.required],
            latitude: [this.location.latitude],
            longitude: [this.location.longitude],
            viewId: [this.location.viewId],
            pageId: [this.location.pageId],
            url: [this.location.url],
            description: [this.location.description],
            showMarkerName: [this.location.showMarkerName],
            showMarkerIcon: [this.location.showMarkerIcon],
            showMarkerValue: [this.location.showMarkerValue],
            markerIcon: [this.location.markerIcon],
            markerImage: [this.location.markerImage],
            markerBackground: [this.location.markerBackground ?? '#ffffff'],
            markerColor: [this.location.markerColor ?? '#000000'],
            markerTagValueId: [this.location.markerTagValueId],
            sourceType: [this.location.sourceType || MapsLocationSourceType.static],
            repeaterData: [this.location.repeaterData],
            latitudeField: [this.location.latitudeField],
            longitudeField: [this.location.longitudeField],
            nameField: [this.location.nameField],
            tagField: [this.location.tagField],
            refreshInterval: [this.location.refreshInterval]
        });
        this.formGroup.controls.name.addValidators(this.isValidName());
        this.formGroup.controls.repeaterData.valueChanges.subscribe(id => this.loadItemFields(id));
        this.loadItemFields(this.location.repeaterData);
    }

    isDynamic(): boolean {
        return this.formGroup?.get('sourceType')?.value === MapsLocationSourceType.dynamic;
    }

    /** fields of the first item of the Repeater data, nested objects as dotted paths (e.g. tags.Alarm) */
    loadItemFields(repeaterId: string) {
        this.itemFields = [];
        this.itemFieldsError = '';
        const repeater = this.repeaters.find(r => r.id === repeaterId);
        const line = repeater?.lines?.[0];
        if (!line) {
            return;
        }
        RepeaterUtils.getItems(line, repeater.id).subscribe({
            next: items => {
                const first = Object.values(items || {})[0];
                const fields: string[] = [];
                const walk = (obj: any, prefix: string, depth: number) => {
                    Object.keys(obj || {}).forEach(key => {
                        const path = prefix ? `${prefix}.${key}` : key;
                        const value = RepeaterUtils.decodeJson(obj[key]);
                        fields.push(path);
                        if (depth < 1 && value && typeof value === 'object' && !Array.isArray(value) && !RepeaterUtils.isTagEntry(value)) {
                            walk(value, path, depth + 1);
                        }
                    });
                };
                walk(RepeaterUtils.decodeJson(first), '', 0);
                this.itemFields = fields;
                this.cdr.detectChanges();
            },
            error: err => {
                this.itemFieldsError = err?.error?.message || err?.message || 'Repeater data not available';
                this.cdr.detectChanges();
            }
        });
    }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        const actions = this.flexActionsStandalone?.getActions() || [];
        const value = this.formGroup.getRawValue();
        if (value.refreshInterval !== null && value.refreshInterval !== undefined && value.refreshInterval !== '') {
            value.refreshInterval = Number(value.refreshInterval) || 0;
        }
        this.location = {...this.location, ...value, actions };
        this.dialogRef.close(this.location);
    }

    isValidName(): ValidatorFn {
        const names = this.projectService.getMapsLocations().map(ml => ml.name);
        return (control: AbstractControl): ValidationErrors | null => {
            if (this.location?.name === control.value) {
                return null;
            }
            if (names?.indexOf(control.value) !== -1) {
                return { name: this.translateService.instant('msg.maps-location-name-exist') };
            }
            return null;
        };
    }

    onMarkerIconSelected() {
        this.formGroup.get('markerImage')?.setValue('');
    }

    onSetMarkerImage(event) {
        if (event.target.files) {
            let filename = event.target.files[0].name;
            let fileToUpload = { type: filename.split('.').pop().toLowerCase(), name: filename.split('/').pop(), data: null };
            let reader = new FileReader();
            reader.onload = () => {
                try {
                    fileToUpload.data = reader.result;
                    this.projectService.uploadFile(fileToUpload).subscribe((result: UploadFile) => {
                        this.formGroup.get('markerImage')?.setValue(result.location);
                        this.formGroup.get('markerIcon')?.setValue('image');
                        this.cdr.detectChanges();
                    });
                } catch (err) {
                    console.error(err);
                }
            };
            if (fileToUpload.type === 'svg') {
                reader.readAsText(event.target.files[0]);
            } else {
                reader.readAsDataURL(event.target.files[0]);
            }
        }
    }

    onTagChanged(tag: FlexDeviceTagValueType) {
        this.formGroup.get('markerTagValueId')?.setValue(tag.variableId);
    }

    onAddAction() {
        const ga = new GaugeAction();
        ga.range = new GaugeRangeProperty();
        this.actions.push(ga);
    }
}
