module.exports = async ({ github, context, core }) => {
    try {
        console.log("tarting Incident Sync Script...");

        const issue = context.payload.issue;
        
        // 1. Extract Basic Incident Data
        const incidentNumber = issue.number;
        const title = issue.title;
        const description = issue.body || ""; 
        const author = issue.user.login;
        const url = issue.html_url;
        
        // Map labels
        const labels = issue.labels ? issue.labels.map(l => l.name) : [];

        console.log(`\n--- Incoming Incident Detected ---`);
        console.log(`Incident #: ${incidentNumber}`);
        console.log(`Title:      ${title}`);
        console.log(`Author:     ${author}`);
        console.log(`Labels:     ${labels.join(', ')}`);
        console.log(`Link:       ${url}`);
        console.log(`-------------------------------------\n`);

        // 2. Logic: Find the Google Doc Link
        const googleDocRegex = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;
        const match = description.match(googleDocRegex);

        if (match && match[1]) {
            const docId = match[1];
            console.log(`SECURITY REPORT FOUND`);
            console.log(`   Doc ID: ${docId}`);
            
            // Export the Doc ID for future steps
            core.setOutput('doc_id', docId);
        } else {
            console.log(`NO SECURITY REPORT ATTACHED`);
            console.log(`   Action: Please ensure a Google Doc link is present.`);
        }

    } catch (error) {
        core.setFailed(`Action Failed: ${error.message}`);
    }
}