const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
    try {
        console.log("Starting Incident Sync Script...");

        // Get the data passed from YAML
        const token = process.env.GITHUB_TOKEN;
        const issueContext = process.env.ISSUE_CONTEXT;
        const repoContext = process.env.REPO_CONTEXT;

        // Parse the JSON strings into usable Objects
        if (!issueContext || !repoContext) {
            throw new Error("Missing ISSUE_CONTEXT or REPO_CONTEXT environment variables.");
        }

        const issue = JSON.parse(issueContext);
        const repo = JSON.parse(repoContext);

        // Extract Basic Incident Data
        const incidentNumber = issue.number;
        const title = issue.title;
        const description = issue.body || ""; // Handle empty descriptions
        const author = issue.user.login;
        const openDate = issue.created_at;
        const url = issue.html_url;
        
        // Map labels to a simple array of strings
        const labels = issue.labels ? issue.labels.map(l => l.name) : [];

        console.log(`\n--- Incoming Incident Detected ---`);
        console.log(`Incident #: ${incidentNumber}`);
        console.log(`Title:      ${title}`);
        console.log(`Author:     ${author}`);
        console.log(`Labels:     ${labels.join(', ')}`);
        console.log(`Link:       ${url}`);
        console.log(`-------------------------------------\n`);

        // Logic: Find the Google Doc Link
        // Regex looks for standard Google Doc URLs
        const googleDocRegex = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;
        const match = description.match(googleDocRegex);

        let docId = null;

        if (match && match[1]) {
            docId = match[1];
            console.log(`SECURITY REPORT FOUND`);
            console.log(`   Doc ID: ${docId}`);
            console.log(`   Full Link: https://docs.google.com/document/d/${docId}`);
            
            // TODO: In Milestone 1 Task 2, we will use this docId to fetch content via Google Drive API
        } else {
            console.log(`NO SECURITY REPORT ATTACHED`);
            console.log(`   Action: Please ensure a Google Doc link is present in the issue description.`);
            // Optional: You could have the bot comment on the issue here asking for the link.
        }

        // 5. Preparation for Mirroring (Milestone 1 Task 3)
        // This is where we will eventually construct the payload for the centralized repo.
        console.log(`\n--- Sync Preparation ---`);
        console.log(`Target: Mirroring logic will go here.`);
        console.log(`Status: Ready for Google API integration.`);

    } catch (error) {
        // This ensures the GitHub Action shows as "Failed" if something crashes
        core.setFailed(`Action Failed: ${error.message}`);
    }
}

run();