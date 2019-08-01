import * as net from 'net';

export class OmniSharpTest {
    File: string = "";
    Project: string = "";
    Id: string = "";
    Label: string = "";
    Line: number = 0;
}

export class OmniSharpTestResult {
    Id: string = "";
    Outcome: string = "";
    ErrorMessage: string = "";
    ErrorStackTrace: string = "";
}

export class OmniSharpClient {

    private socketClient: net.Socket;
    private buffer: string;
    private outstandingResolveFunc: (value: OmniSharpTest[]) => void;
    private outstandingRunTestResult: () => void;
    private runningTests : Set<string>; 
    private readonly testFinishedFunc: (result: OmniSharpTestResult) => void;

    constructor(testFinishedFunc: (result: OmniSharpTestResult) => void) {
        this.outstandingResolveFunc = () => [];
        this.buffer = "";
        this.testFinishedFunc = testFinishedFunc;
        this.runningTests = new Set<string>();
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
                if (!stringData.endsWith("<EOF>")) {
                    this.buffer += stringData;
                    return;
                }
                this.buffer += stringData;
                var trimmedData = this.buffer.substring(0, this.buffer.lastIndexOf("<EOF>"));
                var response = JSON.parse(trimmedData);
                this.buffer = "";
                console.log("Received message of type: " + response.MessageType)
                if (response.MessageType == "enumtests") {
                    this.outstandingResolveFunc(response.Payload as OmniSharpTest[]);
                } else if (response.MessageType == "runtests") {
                    for (var result of response.Payload) {
                        this.testFinishedFunc(result);
                        this.runningTests.delete(result.Id);
                    }
                    if (this.runningTests.size === 0) {
                        this.outstandingRunTestResult();
                    }
                }
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
            console.log("Requesting list of tests from omnisharp");
            const jsonData: string = JSON.stringify({ MessageType: "enumtests", Payload: "" });
            this.socketClient.write(jsonData + "<EOF>");
        });
    }

    async runTests(tests: OmniSharpTest[]): Promise<void> {
        return new Promise((resolve, reject) => {
            for (var test of tests) {
                this.runningTests.add(test.Id);
            }
            this.outstandingRunTestResult = resolve;
            const jsonData: string = JSON.stringify({ MessageType: "runtests", Payload: tests });
            console.log("sending request to run tests: " + jsonData);
            this.socketClient.write(jsonData + "<EOF>");
        });
    }
}