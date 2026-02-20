const GOOGLE_DOC_REGEX = /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;

interface IssueData {
  number: number;
  title: string;
  description: string;
  author: string | null;
  url: string;
  assignees: string[];
  state: string;
  updatedAt: string;
  closedAt: string | null;
  repoName: string;
  labels: string[];
}

// Helper to extract GitHub issue data
function parseIssueData(payload: any): IssueData {
  const { issue, repository } = payload;

  return {
    number: issue.number,
    title: issue.title,
    description: issue.body || "",
    author: issue.user?.login || null,
    url: issue.html_url,
    assignees: issue.assignees?.map((assignee: any) => assignee.login) || [],
    state: issue.state,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at || null,
    repoName: repository.full_name,
    labels: issue.labels?.map((label: any) => label.name) || [],
  };
}

// Helper to extract Google doc markdown data
function extractMarkdownField(markdown: string, fieldName: string): string {
  const safeFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `\\|\\s*(?:\\*\\*|__)?${safeFieldName}(?:\\*\\*|__)?\\s*\\|([^|]+)\\|`,
    "i",
  );
  const match = markdown.match(regex);
  if (match && match[1]) {
    const value = match[1].trim();
    if (value === "SELECT" || value === "" || value === "N/A") {
      return "Not Specified";
    }
    return value;
  }
  return "Not Found";
}

// HELPER: Formats Google Doc dates to strict YYYY-MM-DD for GitHub Projects
function formatDateForGitHub(dateString: string): string | null {
  if (
    !dateString ||
    dateString === "Not Found" ||
    dateString === "Not Specified"
  )
    return null;
  // Extracts the first YYYY-MM-DD sequence it finds
  const match = dateString.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;

  const dateStr = match[1];
  // Validate it's a real date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  // Verify the formatted date matches the input (catches invalid dates like 2024-02-30)
  const [year, month, day] = dateStr.split("-").map(Number);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return dateStr;
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
    if (!clientId || !clientSecret || !refreshToken)
      throw new Error("Missing GCP Secrets.");

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
 * PROJECT V2 GRAPHQL HELPERS
 */
async function getProjectData(
  graphql: any,
  userLogin: string,
  projectNumber: number,
) {
  const query = `
    query($login: String!, $number: Int!) {
      user(login: $login) {
        projectV2(number: $number) {
          id
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType }
            }
          }
        }
      }
    }
  `;
  // Make sure projectNumber is parsed as an Integer for the GraphQL query!
  const result = await graphql(query, {
    login: userLogin,
    number: parseInt(projectNumber.toString(), 10),
  });
  return result.user.projectV2;
}

async function addIssueToProject(
  graphql: any,
  projectId: string,
  contentId: string,
) {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `;
  const result = await graphql(mutation, { projectId, contentId });
  return result.addProjectV2ItemById.item.id;
}

// Updates TEXT fields
async function updateProjectTextField(
  graphql: any,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: string,
) {
  if (!fieldId || !value || value === "Not Found" || value === "Not Specified")
    return;
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `;
  await graphql(mutation, { projectId, itemId, fieldId, value });
}

// HELPER: Updates DATE fields
async function updateProjectDateField(
  graphql: any,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: string | null,
  fieldName?: string,
) {
  if (!fieldId) return;
  if (!value) {
    console.log(
      `   Skipping ${fieldName || "date field"}: no valid date value`,
    );
    return;
  }

  // Final validation: ensure YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.warn(
      `   Invalid date format for ${fieldName || "field"}: ${value}`,
    );
    return;
  }

  try {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { date: $value }
        }) { projectV2Item { id } }
      }
    `;
    await graphql(mutation, { projectId, itemId, fieldId, value });
    console.log(`   ✓ Set ${fieldName || "date"}: ${value}`);
  } catch (error: any) {
    console.error(
      `   ✗ Failed to set ${fieldName || "date field"} to "${value}": ${error.message}`,
    );
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
  fs,
  path,
  getOctokit,
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
    core.notice(
      `Security Incident Report Found: https://docs.google.com/document/d/${docId}`,
    );

    // Fetch the raw Markdown text from google doc
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

    // Debug: Log raw and formatted dates
    core.startGroup("Date Field Debug Info");
    core.info(
      `Raw Opened Date: "${incidentDetails.openedDate}" → Formatted: ${formatDateForGitHub(incidentDetails.openedDate)}`,
    );
    core.info(
      `Raw Closed Date: "${incidentDetails.closedDate}" → Formatted: ${formatDateForGitHub(incidentDetails.closedDate)}`,
    );
    core.info(
      `Raw Last Updated: "${incidentDetails.lastUpdated}" → Formatted: ${formatDateForGitHub(incidentDetails.lastUpdated)}`,
    );
    core.endGroup();

    // Template Replacement
    const workspace = process.env.GITHUB_WORKSPACE || ".";
    const templatePath = path.join(
      workspace,
      ".github/templates/incident-mirror.md",
    );
    let mirroredIssueBody = fs.readFileSync(templatePath, "utf8");

    const replacements: Record<string, string> = {
      "{{DESCRIPTION}}": data.description,
      "{{INCIDENT_NUMBER}}": incidentDetails.incidentNumber,
      "{{INCIDENT_TYPE}}": incidentDetails.incidentType,
      "{{OPENED_DATE}}": incidentDetails.openedDate,
      "{{LAST_UPDATED}}": incidentDetails.lastUpdated,
      "{{LAST_UPDATED_BY}}": incidentDetails.lastUpdatedBy || "",
      "{{CLOSED_DATE}}": incidentDetails.closedDate,
      "{{REPORTED_BY}}": incidentDetails.reportedBy,
      "{{DOC_DESCRIPTION}}": incidentDetails.description,
      "{{PRIORITY}}": incidentDetails.priority,
      "{{STATE}}": incidentDetails.state,
      "{{IMPACTED_BU}}": incidentDetails.impactedCustomerOrBU,
      "{{AFFECTED_SYSTEM}}": incidentDetails.affectedSystem,
      "{{ASSIGNMENT_GROUP}}": incidentDetails.assignmentGroup,
      "{{ASSIGNMENT_TO}}": incidentDetails.assignmentTo,
      "{{ATTACHMENT_OPTIONS}}": incidentDetails.attachmentOptions,
      "{{REPO_NAME}}": data.repoName,
      "{{ISSUE_NUMBER}}": data.number.toString(),
      "{{ISSUE_URL}}": data.url,
      "{{AUTHOR}}": data.author || "Unknown",
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      mirroredIssueBody = mirroredIssueBody.split(placeholder).join(value);
    }

    // Create the Issue in the Target Repository
    const targetOwner = process.env.TARGET_OWNER;
    const targetRepo = process.env.TARGET_REPO;
    const projectToken = process.env.PROJECT_ACCESS_TOKEN;

    if (!targetOwner || !targetRepo || !projectToken) {
      throw new Error(
        "Missing TARGET_OWNER, TARGET_REPO, or PROJECT_ACCESS_TOKEN in env.",
      );
    }

    let targetClient =
      typeof getOctokit === "function"
        ? getOctokit(projectToken)
        : new github.constructor({ auth: projectToken });

    // Create Mirrored Issue
    core.info(
      `Creating mirrored issue in https://github.com/${targetOwner}/${targetRepo}`,
    );
    const newIssue = await targetClient.rest.issues.create({
      owner: targetOwner,
      repo: targetRepo,
      title: `${data.title}`,
      body: mirroredIssueBody,
      labels: [...data.labels, "mirrored-incident"],
      assignees: data.assignees.length > 0 ? data.assignees : undefined,
    });

    const newIssueNodeId = newIssue.data.node_id;
    core.notice(`Mirrored issue created: ${newIssue.data.html_url}`);

    // Add to GitHub Project V2
    core.info("Adding issue to GitHub Project and syncing fields...");
    const projectNumber = process.env.PROJECT_NUMBER;

    if (!projectNumber) {
      throw new Error("Missing PROJECT_NUMBER in environment variables.");
    }

    try {
      const projectData = await getProjectData(
        targetClient.graphql,
        targetOwner,
        projectNumber,
      );
      const projectId = projectData.id;

      const itemId = await addIssueToProject(
        targetClient.graphql,
        projectId,
        newIssueNodeId,
      );

      const fields = projectData.fields.nodes;
      const getFieldId = (name: string) =>
        fields.find((field: any) => field.name === name)?.id;

      // Update Text Fields
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Incident #"),
        incidentDetails.incidentNumber,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Incident Type"),
        incidentDetails.incidentType,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Reported By"),
        incidentDetails.reportedBy,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Description"),
        incidentDetails.description,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Impacted WSO2 BU or Customer"),
        incidentDetails.impactedCustomerOrBU,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Category/Rating/Priority"),
        incidentDetails.priority,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Assignment Group/Team"),
        incidentDetails.assignmentGroup,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Last Updated By"),
        incidentDetails.lastUpdatedBy || "",
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Assignment To"),
        incidentDetails.assignmentTo,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Service/Product/Scope/system/Tool"),
        incidentDetails.affectedSystem,
      );
      await updateProjectTextField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Attachment options for incident report"),
        incidentDetails.attachmentOptions,
      );

      // UPDATE DATE FIELDS
      core.startGroup("Updating Project Date Fields");
      await updateProjectDateField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Opened Date"),
        formatDateForGitHub(incidentDetails.openedDate),
        "Opened Date",
      );
      await updateProjectDateField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Closed date"),
        formatDateForGitHub(incidentDetails.closedDate),
        "Closed Date",
      );
      await updateProjectDateField(
        targetClient.graphql,
        projectId,
        itemId,
        getFieldId("Last Updated"),
        formatDateForGitHub(incidentDetails.lastUpdated),
        "Last Updated",
      );
      core.endGroup();

      core.notice("Successfully synced data to Project V2!");
    } catch (projectError: any) {
      core.warning(
        `Issue created, but failed to sync to Project: ${projectError.message}`,
      );
    }

    // Leave Comment on Original Issue
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
