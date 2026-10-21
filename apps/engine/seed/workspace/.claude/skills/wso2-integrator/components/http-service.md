---
component: http-service
product: wso2-integrator
product_version: 1.127.0
extension_version: wso2.wso2-integrator 1.2.0
last_verified: 2026-10-16
---

# HTTP service

## Flow (verified)

1. From the integration overview, click **Add Artifact manually**. The Artifacts catalogue opens, with tabs All, Automation, Workflow, AI, API, Event, File and Other, and a search box.
2. Under "Integration as API", click **HTTP Service**. The "Create HTTP Service" form opens.
   - Service Contract: "Design From Scratch" is selected by default; the other option is "Import From OpenAPI Specification".
   - **Service Base Path** is required and prefilled with "/".
   - "Advanced Configurations" is collapsed.
3. Type the base path (for example `/greeting`) and click **Create**. It takes about 5 s.
   - The service page shows "Listener: httpDefaultListener Base Path: /greeting", "No resources found", and **Add Resource**.
   - The tree gains "Entry Points › HTTP Service - /greeting" and "Listeners › httpDefaultListener".
4. Click **Add Resource**. A row appears: "Select HTTP Method to Add", with GET POST PUT DELETE PATCH DEFAULT as plain text items (click by exact text).
5. Click **GET**. The "New Resource Configuration" panel opens.
   - **Resource Path** is required, with the placeholder `path/foo`.
   - It also has Path Param, Query Parameter and Header.
   - Responses default to 200 json and 500 error.
   - The panel has "Add more resources", Cancel, and **Save** (disabled until a path is entered).
6. Type the path (for example `hello`) and click **Save**. It takes about 5 s. The resource flow opens: breadcrumb "[get] hello", diagram Start → (+) → Error Handler, and Flow/Sequence tabs.
7. Click the **+** (`empty-node-add-button-1`). The node panel lists:
   - Statement: Declare Variable, Update Variable, Call Function, Map Data
   - Control: If, Match, While, Foreach, **Return**
   - Also AI, Error Handling, Concurrency, Logging
8. Click **Return**. The side panel shows an Expression field ("Return value.").
9. Type the expression, for example `"Hello, World!"`. A Helper Panel opens; click **Close Helper Panel**, then **Save** in the side panel. The diagram shows `Return "Hello, World!"`.
10. The breadcrumb **HTTP Service - /greeting** goes back to the service overview, which lists the resource.

## Selectors

See `../pages/http-service.ts`. All of these are inside `webview()`.
