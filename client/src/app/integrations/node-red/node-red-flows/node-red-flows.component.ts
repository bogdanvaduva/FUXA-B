import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { ProjectService, SaveMode } from '../../../_services/project.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../../_services/auth.service';
import { SettingsService } from '../../../_services/settings.service';
import { EndPointApi } from '../../../_helpers/endpointapi';

@Component({
    selector: 'app-node-red-flows',
    templateUrl: './node-red-flows.component.html',
    styleUrls: ['./node-red-flows.component.scss']
})
export class NodeRedFlowsComponent implements OnInit, OnDestroy {

    private destroy$ = new Subject<void>();
    urlSafe: SafeResourceUrl;
    private _link: string;
    @Input() set link(value: string) {
        this._link = value;
        this.loadLink(value);
    }

    constructor(
        private activeroute: ActivatedRoute,
        public sanitizer: DomSanitizer,
        private projectService: ProjectService,
        private authService: AuthService,
        private settingsService: SettingsService
    ) { }

    ngOnInit() {
        if (this._link) {
            // input
            this.loadLink(this._link);
        } else {
            this.activeroute.params.pipe(
                takeUntil(this.destroy$)
            ).subscribe(params => {
                // routing
                this._link = params['url'] || '/nodered/';
                this.loadLink(this._link);
            });
        }
    }

    ngOnDestroy() {
        this.projectService.saveProject(SaveMode.Current);
        this.destroy$.next(null);
        this.destroy$.complete();
    }

    loadLink(link: string) {
        this._link = link;
        if (this._link) {
            // Convert relative URLs to absolute URLs
            let absoluteUrl = this._link;
            const basePath = EndPointApi.getBasePath();
            if (this._link.startsWith('/') && !this._link.startsWith('//')) {
                // application path (/nodered/, /dashboard/...) - add current origin and base path
                const inBasePath = basePath && (this._link === basePath || this._link.startsWith(basePath + '/'));
                absoluteUrl = inBasePath ? window.location.origin + this._link : EndPointApi.getAppUrl(this._link);
            } else if (!this._link.startsWith('http://') && !this._link.startsWith('https://') && !this._link.startsWith('//')) {
                // Relative URL without leading / - add current origin and base path
                absoluteUrl = EndPointApi.getAppUrl(this._link);
            }
            try {
                const url = new URL(absoluteUrl, window.location.origin);
                const settings = this.settingsService.getSettings();
                const token = this.authService.getUserToken();
                if (settings?.secureEnabled && token && url.origin === window.location.origin) {
                    url.searchParams.set('token', token);
                }
                this.urlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
            } catch {
                this.urlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(absoluteUrl);
            }
        }
    }
}
