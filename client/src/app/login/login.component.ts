import { Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { UntypedFormControl } from '@angular/forms';
import { MatDialogRef as MatDialogRef, MAT_DIALOG_DATA as MAT_DIALOG_DATA } from '@angular/material/dialog';

import { AuthService } from '../_services/auth.service';
import { ProjectService } from '../_services/project.service';
import { TranslateService } from '@ngx-translate/core';
import { NgxTouchKeyboardDirective } from '../framework/ngx-touch-keyboard/ngx-touch-keyboard.directive';
import { LoginOverlayColorType } from '../_models/hmi';
import { EndPointApi } from '../_helpers/endpointapi';
import { environment } from '../../environments/environment';

@Component({
	selector: 'app-login',
	templateUrl: './login.component.html',
	styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {

    @ViewChild('touchKeyboard', {static: false}) touchKeyboard: NgxTouchKeyboardDirective;

	loading = false;
	showPassword = false;
	submitLoading = false;
	messageError: string;
	username: UntypedFormControl = new UntypedFormControl();
	password: UntypedFormControl = new UntypedFormControl();
	errorEnabled = false;
	disableCancel = false;
	ssoDisplayName: string = null;     // OpenID Connect login enabled on the server

	constructor(private authService: AuthService,
				private http: HttpClient,
				private projectService: ProjectService,
				private translateService: TranslateService,
				private dialogRef: MatDialogRef<LoginComponent>,
				@Inject(MAT_DIALOG_DATA) private data: any) {
		const hmi = this.projectService.getHmi();
		this.disableCancel = hmi?.layout?.loginonstart && hmi.layout?.loginoverlaycolor !== LoginOverlayColorType.none;
	}

	ngOnInit(): void {
		if (!environment.serverEnabled) {
			return;
		}
		const header = new HttpHeaders({ 'Skip-Auth': 'true', 'Skip-Error': 'true' });
		this.http.get<{ enabled: boolean, displayName?: string }>(EndPointApi.getURL() + '/api/auth/oidc/metadata', { headers: header }).subscribe({
			next: (metadata) => this.ssoDisplayName = metadata?.enabled ? (metadata.displayName || 'SSO') : null,
			error: () => this.ssoDisplayName = null
		});
	}

	/**
	 * OpenID Connect: full page redirect to the IdP, the server completes the login with the refresh cookie
	 */
	onSsoClick(): void {
		this.submitLoading = true;
		window.location.href = EndPointApi.getURL() + '/api/auth/oidc/login';
	}

	onNoClick(): void {
		this.dialogRef.close();
	}

	onOkClick(): void {
		this.errorEnabled = true;
		this.messageError = '';
		this.signIn();
	}

	isValidate() {
		if (this.username.value && this.password.value) {
			return true;
		}
		return false;
	}

	signIn() {
		this.submitLoading = true;
		this.authService.signIn(this.username.value, this.password.value).subscribe(result => {
			this.projectService.reload().then(() => {
				this.submitLoading = false;
				this.dialogRef.close(true);
			});
		}, error => {
			this.submitLoading = false;
			this.translateService.get('msg.signin-failed').subscribe((txt: string) => this.messageError = txt);
		});
	}

    keyDownStopPropagation(event) {
        event.stopPropagation();
    }

	onFocus(event: FocusEvent) {
		const hmi = this.projectService.getHmi();
		if (hmi?.layout?.inputdialog?.includes('keyboard')) {
			if (hmi.layout.inputdialog === 'keyboardFullScreen') {
				this.touchKeyboard.ngxTouchKeyboardFullScreen = true;
			}
			this.touchKeyboard.closePanel();
			const targetElement = event.target as HTMLInputElement;
			const elementRef = new ElementRef<HTMLInputElement>(targetElement);
			this.touchKeyboard.openPanel(elementRef);
		}
    }
}
