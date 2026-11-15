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
    url_data_type: string;
    url_data_properties: string;
    /** optional dotted path to the items inside the JSON (e.g. 'data' or 'result.items') */
    url_data_path?: string;
}

export class RepeaterUtils {

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

    /** load the JSON of a Repeater data line and return the items to repeat */
    static getItems(line: RepeaterDataLine): Observable<any> {
        return EndPointApi.getJSONFromURL(RepeaterUtils.resolveUrl(line?.url)).pipe(
            map(result => RepeaterUtils.selectItems(result, line?.url_data_path))
        );
    }
}
