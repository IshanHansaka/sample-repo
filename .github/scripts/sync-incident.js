const GOOGLE_DOC_REGEX = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;


// Helper function to extract and sanitize issue data.
function parseIssueData(payload) {
    const { issue, repository } = payload;
    
    return {
        number: issue.number,
        title: issue.title,
        description: issue.body || "",
        author: issue.user?.login || null,
        url: issue.html_url,
        assignees: issue.assignees?.map(a => a.login).join(', ') || null,
        state: issue.state,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at || null,
        repoName: repository.full_name,
        milestone: issue.milestone?.title || null,
        labels: issue.labels?.map(l => l.name) || []
    };
}

/**
 * AUTHENTICATION & EXPORT LOGIC
 * Uses OAuth2 Refresh Token to act as the user (Machine-to-Machine)
 */
async function fetchGoogleDocContent(docId, google) {
    try {
        // Setup OAuth2 Client using your Client ID & Secret
        const auth = new google.auth.OAuth2(
            process.env.GCP_CLIENT_ID,
            process.env.GCP_CLIENT_SECRET
        );

        // Load the Refresh Token
        auth.setCredentials({
            refresh_token: process.env.GCP_REFRESH_TOKEN
        });

        // Create Drive Client
        const drive = google.drive({ version: 'v3', auth });

        console.log(`   Fetching Doc ID: ${docId}...`);

        // Hit the Export API
        const response = await drive.files.export({
            fileId: docId,
            mimeType: 'text/markdown', 
        });

        console.log("    Content fetched and converted to Markdown.");
        return response.data;

    } catch (error) {
        console.error(`   Google Drive API Error: ${error.message}`);
        if (error.code === 403) {
            throw new Error("Permission Denied: The account linked to the Refresh Token does not have access to this Doc.");
        }
        throw error;
    }
}

module.exports = async ({ context, core, google }) => {
    try {
        core.info("Starting Incident Sync Script...");

        if (!context.payload.issue) {
            throw new Error("No issue payload found.");
        }

        // Extract Data using helper
        const data = parseIssueData(context.payload);

        // Log Details (Collapsible in GitHub UI)
        core.startGroup(`Incident #${data.number} Details`);
        core.info(`Title:      ${data.title}`);
        core.info(`Author:     ${data.author}`);
        core.info(`Assignees:  ${data.assignees}`);
        core.info(`State:      ${data.state}`);
        core.info(`Created:    ${data.createdAt}`);
        core.info(`Labels:     ${data.labels.join(', ')}`);
        core.info(`Repository: ${data.repoName}`);
        core.info(`Milestone:  ${data.milestone}`);
        core.info(`Link:       ${data.url}`);

        core.endGroup();

        // Find Google Doc link in the description
        const match = data.description.match(GOOGLE_DOC_REGEX);

        if (match && match[1]) {
            const docId = match[1];
            
            // Use 'notice' to highlight this in the Actions Summary UI
            core.notice(`Security Report Found: ${docId}`);
            core.info(`   Full Link: https://docs.google.com/document/d/${docId}`);

            core.setOutput('doc_id', docId);
            core.setOutput('incident_number', data.number);

            const markdownContent = await fetchGoogleDocContent(docId, google);

            core.startGroup("📄 Markdown Content Preview");
            console.log(markdownContent.substring(0, 1000));

            core.setOutput('doc_id', docId);
            core.setOutput('doc_content', markdownContent);
        } else {
            core.warning("No Security Report Link found in the description.");
        }
    } catch (error) {
        core.setFailed(`Sync Failed: ${error.message}`);
    }
};