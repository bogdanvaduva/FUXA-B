import { GaugeAction } from './hmi';

export class MapsLocation {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    description?: string;
    viewId?: string;
    pageId?: string;
    url?: string;
    showMarkerName?: boolean;
    showMarkerIcon?: boolean;
    showMarkerValue?: boolean;
    markerIcon?: string;
    markerImage?: string;
    markerBackground?: string;
    markerColor?: string;
    markerTagValueId?: string;
    actions?: GaugeAction[];
    /** FUXA-B: static (one marker at latitude/longitude) or dynamic (one marker per item of a Repeater data source) */
    sourceType?: MapsLocationSourceType;
    /** dynamic: id of the Repeater data source */
    repeaterData?: string;
    /** dynamic: item fields (dotted paths, e.g. 'position.lat') with latitude, longitude, name and tag */
    latitudeField?: string;
    longitudeField?: string;
    nameField?: string;
    /** dynamic: item field with the tag of the marker: a tag entry ({ id, value }), a tag id or a tag name */
    tagField?: string;
    /** dynamic: seconds to reload the data (0 or empty: load once) */
    refreshInterval?: number;
    constructor(_id: string) {
        this.id = _id;
    }
}

export enum MapsLocationSourceType {
    static = 'static',
    dynamic = 'dynamic',
}

export const MAPSLOCATION_PREFIX = 'l_';
