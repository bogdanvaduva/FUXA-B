import { Component, OnInit } from '@angular/core';
import { MatDialog, MatDialogRef as MatDialogRef } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';

import { SettingsService } from '../../_services/settings.service';
import { DiagnoseService } from '../../_services/diagnose.service';
import { TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';

import { AlarmsRetentionType, AppSettings, DaqStore, DaqStoreRetentionType, DaqStoreType, MailMessage, SmtpSettings, StoreCredentials, LogsSettings, AlarmsSettings } from '../../_models/settings';
import { Utils } from '../../_helpers/utils';
import { APP_LANGUAGES } from '../../_models/language';
import { EndPointApi } from '../../_helpers/endpointapi';
import { ConfirmDialogComponent } from '../../gui-helpers/confirm-dialog/confirm-dialog.component';
import { environment } from '../../../environments/environment';

/** Project storage of the server (/api/project-storage) */
interface ProjectStorageSettings {
    type: 'sqlite' | 'postgres';
    postgres: { host?: string, port?: number, database?: string, user?: string, password?: string, schema?: string, ssl?: boolean };
}

@Component({
    selector: 'app-app-settings',
    templateUrl: './app-settings.component.html',
    styleUrls: ['./app-settings.component.scss']
})
export class AppSettingsComponent implements OnInit {

    languageType = APP_LANGUAGES.map(language => ({ ...language }));

    authType = [
		{ text: 'dlg.app-auth-disabled', value: '' },
		{ text: 'dlg.app-auth-expiration-15m', value: '15m' },
		{ text: 'dlg.app-auth-expiration-1h', value: '1h' },
		{ text: 'dlg.app-auth-expiration-3h', value: '3h' },
		{ text: 'dlg.app-auth-expiration-1d', value: '1d' }
	];

    nodeRedAuthModeType = [
        { text: 'dlg.app-settings-node-red-auth-secure', value: 'secure' },
        { text: 'dlg.app-settings-node-red-auth-legacy', value: 'legacy-open' }
    ];

    settings = new AppSettings();
    originalNodeRedEnabled = false;
    originalSwaggerEnabled = false;
    originalSecureEnabled = false;
    authentication = '';
    authenticationTooltip = '';
    authOnlyEditorTooltip = '';
    smtpTesting = false;
    smtpTestAddress = '';
    showPassword = false;

    daqstoreType = DaqStoreType;
    retationType = DaqStoreRetentionType;
    alarmsRetationType = AlarmsRetentionType;
    logsRetationType = DaqStoreRetentionType;
    influxDB18 = Utils.getEnumKey(DaqStoreType, DaqStoreType.influxDB18);

    prjStorage: ProjectStorageSettings = { type: 'sqlite', postgres: {} };
    prjStorageCurrent: any = null;
    prjStoragePasswordSet = false;
    prjStorageBusy = false;
    prjReader = { user: '', password: '' };
    prjReaderPasswordSet = false;

    constructor(private settingsService: SettingsService,
        private diagnoseService: DiagnoseService,
        private translateService: TranslateService,
        private toastr: ToastrService,
        private http: HttpClient,
        private dialog: MatDialog,
        public dialogRef: MatDialogRef<AppSettingsComponent>) { }

    ngOnInit() {
        this.settings = JSON.parse(JSON.stringify(this.settingsService.getSettings()));
        for (let i = 0; i < this.languageType.length; i++) {
            this.languageType[i].text = this.translateService.instant(this.languageType[i].text);
        }
        for (let i = 0; i < this.authType.length; i++) {
            this.authType[i].text = this.translateService.instant(this.authType[i].text);
        }
        for (let i = 0; i < this.nodeRedAuthModeType.length; i++) {
            this.nodeRedAuthModeType[i].text = this.translateService.instant(this.nodeRedAuthModeType[i].text);
        }
        this.translateService.get('dlg.app-auth-tooltip').subscribe((txt: string) => { this.authenticationTooltip = txt; });
        this.translateService.get('dlg.app-settings-auth-only-editor-tooltip').subscribe((txt: string) => { this.authOnlyEditorTooltip = txt; });

        if (this.settings.secureEnabled) {
            this.authentication = this.settings.tokenExpiresIn;
        }
        this.originalSecureEnabled = this.settings.secureEnabled;
        if (Utils.isNullOrUndefined(this.settings.broadcastAll)) {
            this.settings.broadcastAll = true;
        }
        if (Utils.isNullOrUndefined(this.settings.lazyViewLoading)) {
            this.settings.lazyViewLoading = false;
        }
        if (Utils.isNullOrUndefined(this.settings.logFull)) {
            this.settings.logFull = false;
        }
        if (!this.settings.smtp) {
            this.settings.smtp = new SmtpSettings();
        }
        this.settings.daqstore = this.settings.daqstore || new DaqStore();
        if (!this.settings.daqstore.credentials) {
            this.settings.daqstore.credentials = new StoreCredentials();
        }
        if (!this.settings.alarms) {
            this.settings.alarms = new AlarmsSettings();
        }
        if (!this.settings.logs) {
            this.settings.logs = new LogsSettings();
        }
        if (Utils.isNullOrUndefined(this.settings.nodeRedEnabled)) {
            this.settings.nodeRedEnabled = false;
        }
        this.originalNodeRedEnabled = this.settings.nodeRedEnabled;
        if (Utils.isNullOrUndefined(this.settings.nodeRedAuthMode)) {
            this.settings.nodeRedAuthMode = 'secure';
        }

        if (Utils.isNullOrUndefined(this.settings.swaggerEnabled)) {
            this.settings.swaggerEnabled = false;
        }
        this.originalSwaggerEnabled = this.settings.swaggerEnabled;
        this.loadPrjStorage();
    }

    private loadPrjStorage() {
        if (!environment.serverEnabled) {
            return;
        }
        this.http.get<any>(EndPointApi.getURL() + '/api/project-storage').subscribe(result => {
            this.prjStorageCurrent = result?.current;
            const postgres = Object.assign({}, result?.settings?.postgres || {});
            this.prjStoragePasswordSet = !!postgres.passwordSet;
            delete postgres.passwordSet;
            this.prjReader = { user: postgres.reader?.user || '', password: '' };
            this.prjReaderPasswordSet = !!postgres.reader?.passwordSet;
            delete postgres.reader;
            this.prjStorage = { type: result?.current?.type || result?.settings?.type || 'sqlite', postgres: Object.assign(postgres, { password: '' }) };
        }, err => {
            this.prjStorageCurrent = null;
        });
    }

    prjStorageCurrentText(): string {
        const current = this.prjStorageCurrent;
        if (!current) {
            return '-';
        }
        if (current.type === 'postgres') {
            return `PostgreSQL ${current.user}@${current.host}:${current.port}/${current.database}` + (current.schema ? ` (${current.schema})` : '');
        }
        return `SQLite ${current.file || ''}`;
    }

    private prjStorageTargetText(): string {
        if (this.prjStorage.type === 'postgres') {
            const pg = this.prjStorage.postgres;
            return `PostgreSQL ${pg.user || ''}@${pg.host || 'localhost'}:${pg.port || 5432}/${pg.database || ''}`;
        }
        return 'SQLite';
    }

    isPrjStorageSwitchReady(): boolean {
        if (this.prjStorageBusy || !this.prjStorageCurrent || this.prjStorage.type === this.prjStorageCurrent.type) {
            return false;
        }
        if (this.prjStorage.type === 'postgres') {
            const pg = this.prjStorage.postgres;
            return !!(pg.host && pg.database && pg.user);
        }
        return true;
    }

    onPrjStorageTest() {
        this.prjStorageBusy = true;
        this.http.post<any>(EndPointApi.getURL() + '/api/project-storage/test', this.prjStorage).subscribe(() => {
            this.prjStorageBusy = false;
            this.toastr.success(this.translateService.instant('msg.prjstorage-test-success'));
        }, err => {
            this.prjStorageBusy = false;
            this.notifyError(err?.error?.message || err?.message || 'Connection failed');
        });
    }

    onPrjReaderSave() {
        this.prjStorageBusy = true;
        this.http.post<any>(EndPointApi.getURL() + '/api/project-storage/reader', this.prjReader).subscribe(result => {
            this.prjStorageBusy = false;
            this.prjReaderPasswordSet = !!result?.settings?.postgres?.reader?.passwordSet;
            this.prjReader.password = '';
            this.toastr.success(this.translateService.instant('msg.prjstorage-reader-saved'));
        }, err => {
            this.prjStorageBusy = false;
            this.notifyError(err?.error?.message || err?.message || 'Reader login failed');
        });
    }

    onPrjStorageSwitch() {
        const target = this.prjStorageTargetText();
        const confirm = this.dialog.open(ConfirmDialogComponent, {
            data: { msg: this.translateService.instant('msg.prjstorage-switch-confirm', { value: target }) },
            position: { top: '60px' }
        });
        confirm.afterClosed().subscribe(ok => {
            if (!ok) {
                return;
            }
            this.prjStorageBusy = true;
            this.http.post<any>(EndPointApi.getURL() + '/api/project-storage/switch', this.prjStorage).subscribe(result => {
                this.prjStorageBusy = false;
                let msg = this.translateService.instant('msg.prjstorage-switch-success', { value: target, rows: result?.rows ?? 0 });
                if (result?.backup) {
                    msg += ' ' + this.translateService.instant('msg.prjstorage-switch-backup', { value: result.backup });
                }
                this.toastr.success(msg, '', { timeOut: 8000, closeButton: true });
                this.loadPrjStorage();
            }, err => {
                this.prjStorageBusy = false;
                this.toastr.error(err?.error?.message || err?.message || 'Switch failed', '', { disableTimeOut: true, closeButton: true });
            });
        });
    }

    onNoClick() {
        this.dialogRef.close();
    }

    onOkClick() {
        if (this.authentication && !this.originalSecureEnabled && (!this.settings.secretCode || !this.settings.secretCode.length)) {
            let msg = this.translateService.instant('msg.secret-code-required');
            this.notifyError(msg);
            return;
        }
        this.settings.secureEnabled = (this.authentication) ? true : false;
        this.settings.tokenExpiresIn = this.authentication;
        if (this.settingsService.setSettings(this.settings)) {
            this.settingsService.saveSettings();
        }
        this.dialogRef.close();
    }

    onLanguageChange(language) {
        this.settings.language = language;
    }

    onAlarmsClear() {
        this.settingsService.clearAlarms(true);
    }

    onSmtpTest() {
        this.smtpTesting = true;
        let msg = <MailMessage>{ from: this.settings.smtp.mailsender || this.settings.smtp.username, to: this.smtpTestAddress, subject: 'FUXA', text: 'TEST' };
        this.diagnoseService.sendMail(msg, this.settings.smtp).subscribe(() => {
            this.smtpTesting = false;
            var msg = '';
            this.translateService.get('msg.sendmail-success').subscribe((txt: string) => { msg = txt; });
            this.toastr.success(msg);
        }, error => {
            this.smtpTesting = false;
            if (error.message) {
                this.notifyError(error.message);
            } else {
                var msg = '';
                this.translateService.get('msg.sendmail-error').subscribe((txt: string) => { msg = txt; });
                this.notifyError(msg);
            }
        });
    }

    isSmtpTestReady() {
        if (this.smtpTesting) {
            return false;
        }
        if (!this.settings.smtp.host || !this.settings.smtp.host.length) {
            return false;
        }
        if (!this.settings.smtp.port) {
            return false;
        }
        if (!this.smtpTestAddress || !this.smtpTestAddress.length) {
            return false;
        }
        return true;
    }

    keyDownStopPropagation(event) {
        event.stopPropagation();
    }

    private notifyError(error: string) {
        this.toastr.error(error, '', {
            timeOut: 3000,
            closeButton: true
            // disableTimeOut: true
        });
    }
}
