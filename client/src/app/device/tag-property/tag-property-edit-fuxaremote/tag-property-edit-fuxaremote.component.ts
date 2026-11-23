import { Component, OnInit, Inject, OnDestroy, ViewChild, Output, EventEmitter } from '@angular/core';
import { MAT_DIALOG_DATA as MAT_DIALOG_DATA, MatDialogRef as MatDialogRef } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { HmiService } from '../../../_services/hmi.service';
import { Device, Tag } from '../../../_models/device';
import { TreetableComponent, Node, NodeType } from '../../../gui-helpers/treetable/treetable.component';

/**
 * Browse the devices and tags of a remote FUXA server ('FuxaRemote' device) to mirror them
 */
@Component({
    selector: 'app-tag-property-edit-fuxaremote',
    templateUrl: './tag-property-edit-fuxaremote.component.html',
    styleUrls: ['./tag-property-edit-fuxaremote.component.scss']
})
export class TagPropertyEditFuxaRemoteComponent implements OnInit, OnDestroy {
    @Output() result = new EventEmitter<TagPropertyFuxaRemoteData>();
    @ViewChild(TreetableComponent, { static: false }) treetable: TreetableComponent;
    private destroy$ = new Subject<void>();
    error = '';
    loading = true;

    config = {
        height: '640px',
        width: '1000px'
    };

    constructor(
        private hmiService: HmiService,
        public dialogRef: MatDialogRef<TagPropertyEditFuxaRemoteComponent>,
        @Inject(MAT_DIALOG_DATA) public data: TagPropertyFuxaRemoteData) {
    }

    ngOnInit() {
        this.hmiService.onDeviceBrowse.pipe(
            takeUntil(this.destroy$),
        ).subscribe(values => {
            if (this.data.device.id !== values.device) {
                return;
            }
            this.loading = false;
            if (values.error) {
                this.error = `${values.error}`;
            } else {
                this.error = '';
                this.addNodes(values.node, values.result);
            }
        });
        this.queryNext(null);
    }

    ngOnDestroy() {
        this.destroy$.next(null);
        this.destroy$.complete();
    }

    queryNext(node: Node) {
        this.loading = true;
        this.hmiService.askDeviceBrowse(this.data.device.id, node ? { id: node.id } : null);
    }

    addNodes(parent: Node, nodes: any[]) {
        if (!nodes) {
            return;
        }
        // parent is the browse request ({ id }), the treetable resolves it to the device node
        const mirrored = Object.values(this.data.device.tags || {}).map((t: Tag) => t.address);
        nodes.forEach((n) => {
            const node = new Node(n.id, n.name);
            node.class = Node.strToType(n.class);
            node.type = n.type || '';
            if (node.class === NodeType.Variable) {
                node.property = n.description || '';
                node.expandable = false;
            }
            const enabled = node.class !== NodeType.Variable || !mirrored.includes(n.id);
            this.treetable.addNode(node, parent, enabled, false);
        });
        this.treetable.update();
    }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        this.data.nodes = (<Node[]>Object.values(this.treetable.nodes)).filter((n: Node) =>
            n.checked && n.enabled && n.class === NodeType.Variable);
        this.result.emit(this.data);
    }
}

export interface TagPropertyFuxaRemoteData {
    device: Device;
    nodes?: Node[];
}
