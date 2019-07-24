import * as net from 'net';

const fakeOmnisharpResponse: object = [
    {
        File: "c:\\Enlist\\foo.cs",
        Project: "foo",
        Id: "DBS.Coordinator.BuildDispatcherTest.TestDispatch",
        Label: "TestDispatch",
        Line: 80
    },
    {
        File: "c:\\Enlist\\foo.cs",
        Project: "foo",
        Id: "DBS.Coordinator.BuildDispatcherTest.LoadBuildTest",
        Label: "LoadBuildTest",
        Line: 81
    },
    {
        File: "c:\\Enlist\\bar.cs",
        Project: "foo",
        Id: "DBS.Coordinator.WorkflowTest.GitClient",
        Label: "GitClient",
        Line: 11
    },
    {
        File: "c:\\Enlist\\foo2.cs",
        Project: "baz",
        Id: "DBS.TaskDelegator.Enlister.SourceDepotTest",
        Label: "SourceDepotTest",
        Line: 1111
    }
];

export class OmniSharpTest {
    File: string = "";
    Project: string = "";
    Id: string = "";
    Label: string = "";
    Line: number = 0;
}
export class OmniSharpClient {

    private socketClient: net.Socket;
    private outstandingResolveFunc: (value: OmniSharpTest[]) => void;
    constructor() {
        this.outstandingResolveFunc = () => [];
    }

    public async connect(): Promise<void> {
        var connected: boolean = false;
        while (!connected) {
            console.log("creating socket client");
            try {
                await this.createSocketClient();
                connected = true;
                break;
            } catch (error) {
                console.log("caught error")
            }
            console.log("sleeping");
            var sab = new SharedArrayBuffer(16);
            var waitArray = new Int32Array(sab);
            Atomics.wait(waitArray, 0, 2, 2000);
        }
    }

    private createSocketClient(): Promise<void> {
        return new Promise((resolve, reject) => {

            var socket = new net.Socket();
            socket.connect(12345, 'localhost', function () {
                console.log('Connecting to omnisharp');
            });
            socket.on('connect', () => {
                console.log("connected");
                this.socketClient = socket;
                resolve();
            });
            socket.on('data', data => {
                console.log('Received: ' + data);
                var stringData = data.toString();
                this.outstandingResolveFunc(JSON.parse(stringData) as OmniSharpTest[]);
            });

            socket.on('error', function (data) {
                console.log('Error talking to omnisharp: ' + data);
            });

            socket.on('close', function () {
                console.log('Connection closed');
                reject("connection closed, failing connect() call");
            });
        });
    }

    enumerateAvailableTests(): Promise<OmniSharpTest[]> {
        return new Promise<OmniSharpTest[]>((resolve, reject) => {

            this.outstandingResolveFunc = resolve;
            console.log("sending request to omnisharp for data");
            const jsonData: string = JSON.stringify({ MessageType: "enumtests", Payload: "" });
            try {
                console.log(this.socketClient == null);
                var flushed: boolean = this.socketClient.write(jsonData + "<EOF>");
                console.log("socket write result: " + flushed);
                //resolve(JSON.parse(JSON.stringify(fakeOmnisharpResponse)) as OmniSharpTest[]);
            } catch (error) {
                console.log("caught error when trying to send data");
            }
        });
    }

    async runTests(tests: OmniSharpTest[]) : Promise<void> {
        
    }
}