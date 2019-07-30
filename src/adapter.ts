import * as vscode from 'vscode';
import { TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent, TestSuiteInfo, TestInfo } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { OmniSharpTest, OmniSharpClient, OmniSharpTestResult } from './omnisharpClient';
import * as path from 'path';

export class OmniSharpAdapter implements TestAdapter {

	private disposables: { dispose(): void }[] = [];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();
	private omnisharpClient: OmniSharpClient;
	private discoveredTests: Map<string, OmniSharpTest>;
	private rootTestNode: TestSuiteInfo;

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {

		console.log('Initializing omnisharp adapter');

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
		this.discoveredTests = new Map<string, OmniSharpTest>();
	}

	async load(): Promise<void> {
		console.log('Enumerating tests from OmniSharp');
		if (!this.omnisharpClient) {
			console.log('connecting client for load() call');
			var client = new OmniSharpClient((result: OmniSharpTestResult) => this.onTestCompleted(result));
			await client.connect();
			this.omnisharpClient = client;
		}

		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
		var loadedTests: OmniSharpTest[];
		try {
			loadedTests = await this.omnisharpClient.enumerateAvailableTests();
			this.storeTestsById(loadedTests);
		} catch (error) {
			console.log("caught error enumerating tests");
		}
		const testExplorerSuite = this.convertOmniSharpDataToExplorerData(loadedTests);
		this.rootTestNode = testExplorerSuite;

		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: testExplorerSuite });
	}

	onTestCompleted(result: OmniSharpTestResult) {
		const stateValue: string = this.mapOmniSharpResultTypeToTestExplorerType(result.Outcome);
		var message = null;
		if (stateValue === "failed") {
			message = result.ErrorMessage + '\n' + result.ErrorStackTrace;
		}
		this.testStatesEmitter.fire(<TestEvent>{ type: 'test', test: result.Id, state: stateValue, message: message })
	}

	storeTestsById(omnisharpTests: OmniSharpTest[]) {
		this.discoveredTests.clear();
		for (var test of omnisharpTests) {
			this.discoveredTests.set(test.Id, test);
		}
	}

	convertOmniSharpDataToExplorerData(omnisharpTests: OmniSharpTest[]): TestSuiteInfo {
		var rootTestSuite: TestSuiteInfo = {
			type: 'suite',
			id: 'root',
			label: 'mstest',
			children: []
		};
		var projects = new Map<string, TestSuiteInfo>();
		var testSourceFiles = new Map<string, TestSuiteInfo>();
		for (var test of omnisharpTests) {
			const testProject = test.Project;
			const testFileName = test.File;
			if (!projects.has(testProject)) {
				const projectSuite: TestSuiteInfo = { type: "suite", id: testProject, label: testProject, children: [] };
				projects.set(testProject, projectSuite);
				rootTestSuite.children.push(projectSuite);
			}
			if (!testSourceFiles.has(testFileName)) {
				const fileSuite: TestSuiteInfo = { type: "suite", id: testFileName, label: testFileName.substring(testFileName.lastIndexOf(path.sep) + 1), file: testFileName, children: [] };
				testSourceFiles.set(testFileName, fileSuite);
				projects.get(testProject)!.children.push(fileSuite);
			}
			testSourceFiles.get(testFileName)!.children.push({ type: "test", id: test.Id, label: test.Label, file: test.File, line: test.Line });
		}
		return rootTestSuite;
	}

	async run(tests: string[]): Promise<void> {

		this.log.info(`Running tests ${JSON.stringify(tests)}`);

		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		for (const suiteOrTestId of tests) {
			const node = this.findNode(this.rootTestNode, suiteOrTestId);
			if (node) {
				var testsToRun = [] as OmniSharpTest[]; 
				this.findAllTestsToRunAndMarkAsRunning(node, testsToRun);
				await this.omnisharpClient.runTests(testsToRun);
			}
		}

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });

	}

	/*	implement this method if your TestAdapter supports debugging tests
		async debug(tests: string[]): Promise<void> {
			// start a test run in a child process and attach the debugger to it...
		}
	*/

	private findAllTestsToRunAndMarkAsRunning(searchNode: TestSuiteInfo | TestInfo, results: OmniSharpTest[]) {
		if (searchNode.type === 'test') {
			this.testStatesEmitter.fire(<TestEvent>{ type: 'test', test: searchNode.id, state: 'running' });
			results.push(this.discoveredTests.get(searchNode.id)!);
		} else {
			for (var child of searchNode.children) {
				this.findAllTestsToRunAndMarkAsRunning(child, results);
			}
		}
	}

	findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found) return found;
			}
		}
		return undefined;
	}

	async runNode(
		node: TestSuiteInfo | TestInfo,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
	): Promise<void> {

		if (node.type === 'suite') {

			testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

			for (const child of node.children) {
				await this.runNode(child, testStatesEmitter);
			}

			testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

		} else { // node.type === 'test'

			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'passed' });

		}
	}

	cancel(): void {
		// in a "real" TestAdapter this would kill the child process for the current test run (if there is any)
		throw new Error("Method not implemented.");
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}

	private mapOmniSharpResultTypeToTestExplorerType(outcome: string): string {
		switch (outcome.toLowerCase()) {
			case "passed":
				return "passed";
			case "failed":
				return "failed";
			case "skipped":
				return "skipped";
			case "notfound":
				return "errored";
			case "running":
				return "running";
			default:
				return "errored";
		}
		return "errored";
	}
}
