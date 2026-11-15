import { HttpClient, HttpXhrBackend } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { EndPointApi } from '../_helpers/endpointapi';

export class RepeaterData {
    id: string;
    name: string;
    lines: RepeaterDataLine[];
}

export class RepeaterDataLine {
    id: string;
    name: string;
    url: string;
    /** RepeaterDataType: 'json' (default, also any legacy value) or 'csv' */
    url_data_type: string;
    url_data_properties: string;
    /** optional dotted path to the items inside the JSON (e.g. 'data' or 'result.items') */
    url_data_path?: string;
}

export enum RepeaterDataType {
    json = 'json',
    csv = 'csv',
}

export class RepeaterUtils {

    static isCsv(line: RepeaterDataLine): boolean {
        return (line?.url_data_type || '').toLowerCase() === RepeaterDataType.csv;
    }

    /**
     * Absolute http(s) URLs are used as they are (GitHub file pages are mapped to the raw file),
     * relative paths are resolved against the FUXA server (e.g. a path configured in settings.proxies).
     */
    static resolveUrl(url: string): string {
        const value = (url || '').trim();
        const github = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
        if (github) {
            return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`;
        }
        if (/^https?:\/\//i.test(value)) {
            return value;
        }
        return EndPointApi.getURL() + (value.startsWith('/') ? value : '/' + value);
    }

    /** return the items (array or object) found at the dotted path, the whole JSON without path */
    static selectItems(json: any, path?: string): any {
        const keys = (path || '').split('.').map(k => k.trim()).filter(k => k);
        const items = keys.reduce((obj, key) => (obj === null || obj === undefined) ? undefined : obj[key], json);
        return items ?? {};
    }

    /**
     * Parse CSV text (RFC 4180 quoting) into objects keyed by the header row.
     * The delimiter (comma, semicolon or tab) is detected from the header line.
     */
    static parseCsv(text: string): any[] {
        const source = (text || '').replace(/^\uFEFF/, '');
        const headerLine = source.split(/\r?\n/, 1)[0];
        const count = (d: string) => headerLine.split(d).length;
        const delimiter = [';', '\t'].reduce((best, d) => count(d) > count(best) ? d : best, ',');
        const rows: string[][] = [];
        let row: string[] = [];
        let field = '';
        let quoted = false;
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (quoted) {
                if (c === '"' && source[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (c === '"') {
                    quoted = false;
                } else {
                    field += c;
                }
            } else if (c === '"') {
                quoted = true;
            } else if (c === delimiter) {
                row.push(field);
                field = '';
            } else if (c === '\n' || c === '\r') {
                if (c === '\r' && source[i + 1] === '\n') {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += c;
            }
        }
        if (field !== '' || row.length) {
            row.push(field);
            rows.push(row);
        }
        const lines = rows.filter(r => r.some(v => v.trim() !== ''));
        if (!lines.length) {
            return [];
        }
        const header = lines[0].map(h => h.trim());
        return lines.slice(1).map(r => header.reduce((item, key, index) => {
            item[key] = (r[index] ?? '').trim();
            return item;
        }, {}));
    }

    /** load the data of a Repeater data line (JSON or CSV) and return the items to repeat */
    static getItems(line: RepeaterDataLine): Observable<any> {
        const url = RepeaterUtils.resolveUrl(line?.url);
        if (RepeaterUtils.isCsv(line)) {
            const http = new HttpClient(new HttpXhrBackend({ build: () => new XMLHttpRequest() }));
            return http.get(url, { responseType: 'text' }).pipe(map(text => RepeaterUtils.parseCsv(text)));
        }
        return EndPointApi.getJSONFromURL(url).pipe(
            map(result => RepeaterUtils.selectItems(result, line?.url_data_path))
        );
    }
}
