const GOOGLE_DOC_REGEX = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;

// --- INTERFACES ---
interface IssueData {
  number: number;
  title: string;
  description: string;
  author: string | null;
  url: string;
  assignees: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  repoName: string;
  milestone: string | null;
  labels: string[];
}

// Helper to extract GitHub data
function parseIssueData(payload: any): IssueData {
  const { issue, repository } = payload;

  return {
    number: issue.number,
    title: issue.title,
    description: issue.body || "",
    author: issue.user?.login || null,
    url: issue.html_url,
    assignees: issue.assignees?.map((a: any) => a.login).join(", ") || null,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at || null,
    repoName: repository.full_name,
    milestone: issue.milestone?.title || null,
    labels: issue.labels?.map((l: any) => l.name) || [],
  };
}

// --- NEW HELPER: EXTRACT FROM MARKDOWN TABLE ---
function extractMarkdownField(markdown: string, fieldName: string): string {
  // Escapes special characters in the field name
  const safeFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Regex looks for: | **Field Name** | Value | (ignoring bold/italics and whitespace)
  const regex = new RegExp(
    `\\|\\s*(?:\\*\\*|__)?${safeFieldName}(?:\\*\\*|__)?\\s*\\|([^|]+)\\|`,
    "i",
  );
  const match = markdown.match(regex);

  if (match && match[1]) {
    const value = match[1].trim();
    // Clean up empty template placeholders
    if (value === "SELECT" || value === "" || value === "N/A") {
      return "Not Specified";
    }
    return value;
  }
  return "Not Found";
}

/**
 * AUTHENTICATION & EXPORT LOGIC
 */
async function fetchGoogleDocContent(
  docId: string,
  google: any,
): Promise<string> {
  try {
    const clientId = (process.env.GCP_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GCP_CLIENT_SECRET || "").trim();
    const refreshToken = (process.env.GCP_REFRESH_TOKEN || "").trim();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing GCP Secrets.");
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    const drive = google.drive({ version: "v3", auth });

    console.log(`   Fetching Doc ID: ${docId}...`);

    const response = await drive.files.export({
      fileId: docId,
      mimeType: "text/markdown",
    });

    console.log("   Content fetched.");
    return response.data as string;
  } catch (error: any) {
    console.error(`Google Error Details:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`   Message: ${error.message}`);
    }
    throw error;
  }
}

/**
 * MAIN FUNCTION EXPORT
 */
module.exports = async ({
  context,
  core,
  google,
  github,
}: any): Promise<void> => {
  try {
    core.info("Starting Incident Parser & Mirroring...");

    if (!context.payload.issue) throw new Error("No issue payload found.");

    const data = parseIssueData(context.payload);
    const match = data.description.match(GOOGLE_DOC_REGEX);

    if (!match || !match[1]) {
      core.warning("No Google Doc link found in description. Exiting.");
      return;
    }

    const docId = match[1];
    const docUrl = `https://docs.google.com/document/d/${docId}`;

    core.notice(`Security Report Found: ${docId}`);
    core.info(`   Full Link: https://docs.google.com/document/d/${docId}`);

    // Fetch the raw Markdown text
    const markdownText = await fetchGoogleDocContent(docId, google);

    // Parse the specific fields into our final variables object
    const incidentDetails = {
      incidentNumber: `INC-${data.number}`,
      incidentType: extractMarkdownField(markdownText, "Incident type"),
      openedDate: extractMarkdownField(markdownText, "Incident reported on"),
      lastUpdated: data.updatedAt,
      lastUpdatedBy: data.author,
      closedDate: extractMarkdownField(markdownText, "Incident closed on"),
      reportedBy: extractMarkdownField(markdownText, "Reporter"),
      description: extractMarkdownField(markdownText, "Incident Overview"),
      impactedCustomerOrBU: extractMarkdownField(
        markdownText,
        "Customer(s) Impacted",
      ),
      state: data.state,
      priority: extractMarkdownField(markdownText, "Priority"),
      assignmentTo: extractMarkdownField(markdownText, "Coordinator"),
      assignmentGroup: extractMarkdownField(
        markdownText,
        "Incident owning team (Custodi an)",
      ),
      affectedSystem: extractMarkdownField(markdownText, "Affected system(s)"),
      attachmentOptions: docUrl,
    };

    // Print the variables to verify they parsed correctly
    core.startGroup("Parsed Incident Variables");
    console.log(JSON.stringify(incidentDetails, null, 2));
    core.endGroup();

    core.setOutput("incident_data_json", JSON.stringify(incidentDetails));

    // Build the Markdown Body for the Centralized Repo Issue
    const mirroredIssueBody = `
        ### Description
        ${data.description}

        ---

        ## Security Incident Report

        | Field | Value |
        |---|---|
        | **Incident #** | ${incidentDetails.incidentNumber} |
        | **Incident Type** | ${incidentDetails.incidentType} |
        | **Opened Date** | ${incidentDetails.openedDate} |
        | **Last Updated** | ${incidentDetails.lastUpdated} |
        | **Last Updated By** | ${incidentDetails.lastUpdatedBy} |
        | **Closed Date** | ${incidentDetails.closedDate} |
        | **Reported By** | ${incidentDetails.reportedBy} |
        | **Description** | ${incidentDetails.description} |
        | **Priority** | ${incidentDetails.priority} |
        | **State** | ${incidentDetails.state} |
        | **Impacted BU/Customer** | ${incidentDetails.impactedCustomerOrBU} |
        | **Affected System** | ${incidentDetails.affectedSystem} |
        | **Assignment Group** | ${incidentDetails.assignmentGroup} |
        | **Assignment To** | ${incidentDetails.assignmentTo} |
        | **Service/Product/Scope/system/Tool** | ${incidentDetails.assignmentTo} |
        | **Attachment options for incident report** | ${incidentDetails.attachmentOptions} |
        ---

        **Original Issue:** [${data.repoName}#${data.number}](${data.url})
        **Original Author:** [${data.author}](${`https://github.com/${data.author}`})
        **Google Doc Report:** [View Full Document](${incidentDetails.attachmentOptions})
    `;

    // Create the Issue in the Target Repository
    const targetOwner = "IshanHansaka";
    const targetRepo = "centralised-repo";

    core.info(`Creating mirrored issue in ${targetOwner}/${targetRepo}...`);

    const newIssue = await github.rest.issues.create({
      owner: targetOwner,
      repo: targetRepo,
      title: `${data.title}`,
      body: mirroredIssueBody,
      labels: [...data.labels, "mirrored-incident"],
      milestones: data.milestone ? [data.milestone] : undefined,
    });

    core.notice(
      `Mirrored issue created successfully: ${newIssue.data.html_url}`,
    );

    // Add a comment to the ORIGINAL issue linking to the new one
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: `**Incident Mirrored Successfully**\nA mirrored ticket containing the parsed document data has been created in the centralized repository: ${newIssue.data.html_url}`,
    });
  } catch (error: any) {
    core.setFailed(`Sync Failed: ${error.message}`);
  }
};
