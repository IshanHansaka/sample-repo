const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
    try {
        console.log("Starting Incident Sync Script...");

        // Get the data passed from YAML
        const token = process.env.GITHUB_TOKEN;
        const issueContext = process.env.ISSUE_CONTEXT;
        const repoContext = process.env.REPO_CONTEXT;

        if (!issueContext || !repoContext) {
            throw new Error("Missing ISSUE_CONTEXT or REPO_CONTEXT environment variables.");
        }

        const issue = JSON.parse(issueContext);
        // Extract Basic Incident Data
        const incidentNumber = issue.number;
        const title = issue.title;
        const description = issue.body || ""; 
        const author = issue.user.login;
        const url = issue.html_url;
        const labels = issue.labels ? issue.labels.map(l => l.name) : [];

        console.log(`\n--- Incoming Incident Detected ---`);
        console.log(`Incident #: ${incidentNumber}`);
        console.log(`Title:      ${title}`);
        console.log(`Author:     ${author}`);
        console.log(`Labels:     ${labels.join(', ')}`);
        console.log(`Link:       ${url}`);
        console.log(`-------------------------------------\n`);

        // Logic: Find the Google Doc Link
        const googleDocRegex = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;
        const match = description.match(googleDocRegex);

        if (match && match[1]) {
            const docId = match[1];
            console.log(`SECURITY REPORT FOUND`);
            console.log(`   Doc ID: ${docId}`);
            console.log(`   Full Link: https://docs.google.com/document/d/${docId}`);
            
            // Export the Doc ID for the next step (Milestone 2)
            core.setOutput('doc_id', docId);
        } else {
            console.log(`NO SECURITY REPORT ATTACHED`);
            console.log(`   Action: Please ensure a Google Doc link is present.`);
        }

    } catch (error) {
        core.setFailed(`Action Failed: ${error.message}`);
    }
}

run();