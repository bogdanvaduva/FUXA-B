
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
}
