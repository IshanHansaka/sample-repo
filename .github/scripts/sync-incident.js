module.exports = async ({ context, core }) => {
    try {
        console.log("starting Incident Sync Script...");

        const issue = context.payload.issue;
        
        // Extract Basic Incident Data
        const incidentNumber = issue.number;
        const title = issue.title;
        const description = issue.body || ""; 
        const author = issue.user.login;
        const url = issue.html_url;
        const assignee = issue.assignee ? issue.assignee.login : null;
        const state = issue.state;
        const createdAt = issue.created_at;
        const updatedAt = issue.updated_at;
        const closedAt = issue.closed_at;
        const repository = context.payload.repository.full_name;
        const project = issue.project ? issue.project.name : null;
        const milestone = issue.milestone ? issue.milestone.title : null;
        
        // Map labels
        const labels = issue.labels ? issue.labels.map(l => l.name) : [];

        console.log(`\n---- Incoming Incident Detected ----`);
        console.log(`Incident #: ${incidentNumber}`);
        console.log(`Title:      ${title}`);
        console.log(`Author:     ${author}`);
        console.log(`Assignee:   ${assignee}`);
        console.log(`State:      ${state}`);
        console.log(`Created:    ${createdAt}`);
        console.log(`Updated:    ${updatedAt}`);
        console.log(`Closed:     ${closedAt}`);
        console.log(`Labels:     ${labels.join(', ')}`);
        console.log(`Link:       ${url}`);
        console.log(`Repository: ${repository}`);
        console.log(`Project:    ${project}`);
        console.log(`Milestone:  ${milestone}`);
        console.log(`-------------------------------------\n`);

        // Find the Google Doc Link
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
        }
    } catch (error) {
        core.setFailed(`Action Failed: ${error.message}`);
    }
}