# BeauSana

A local Windows dashboard for Slack, assigned Asana tasks, test-server links and accessibility references. It uses ordinary links, labelled forms, headings, visible focus and restrained status announcements.

## Dashboard and Slack

Start the app using **Start BeauSana.cmd**, then choose **Slack messages**, **Asana tasks**, or **Quick links and references**. The dashboard checks connections and updates when opened. **Check updates now** checks again; optionally enable checks every two minutes while the dashboard is visible. New notices appear in a list without moving focus. Slack checks include the default channel, newly opened conversations, and summaries for up to 20 active DMs per check to limit API traffic. These are polling notices, not OS notifications; notices reset when the dashboard page reloads. Opening messages does not change Slack's own read marker. Local reading markers help avoid repeated initial notices on this browser.

Slack's default workspace is **quavered.slack.com**, default channel **#a11y-auditing**, ID **C0C7Q7AJT7Y**. Users authorize their own accounts through OAuth; no Slack PAT or token is pasted into the browser. **Try example conversations** works before a Slack app is configured. Example sends, replies, files and reactions stay in memory and never reach Slack.

The Slack page lists the default channel and existing active DMs. Conversation links and thread links use browser history; Back returns between threads, conversations and pages. Messages have **Thumbs up**, **Seen (eyes)** and **Done (check mark)** toggle responses, ordinary Slack reactions visible to other participants. Use **Send message** to submit; Enter in the text box adds a new line. Thread replies and file uploads target the conversation selected at submission even if navigation changes while the request finishes. Drafts remain in memory per conversation/thread until disconnect or page reload. Refreshing messages rebuilds the list; if JAWS retains an old virtual buffer, press **Insert+Esc** (desktop layout) or **Caps Lock+Esc** (laptop layout).

### Administrator: enable Slack login

1. Create an internal Slack app in the QuaverEd workspace at [Slack app management](https://api.slack.com/apps). Workspace policy may require an owner/admin to approve installation. Start with the scopes and settings in `slack-app-manifest.example.json`, or configure them manually.
2. In **OAuth & Permissions**, add these **User Token Scopes**, not bot scopes:
   - `channels:read`, `channels:history`: locate/read the default public channel.
   - `im:read`, `im:history`: list active DMs and read their messages.
   - `users:read`: resolve participant names.
   - `chat:write`: send messages and thread replies as the user.
   - `files:read`, `files:write`: download Slack-hosted files and share uploads.
   - `reactions:read`, `reactions:write`: message responses.
3. If **#a11y-auditing is private**, also add `groups:read`, `groups:history`, and set `SLACK_PRIVATE_CHANNEL=true`. If group DMs are needed, add `mpim:read`, `mpim:history`, and set `SLACK_GROUP_DMS=true`. The user must already be a member of the default channel. New DMs are opened in Slack itself; the dashboard lists existing ones.
4. Obtain a stable **HTTPS callback URL** whose `/api/slack/oauth/callback` path forwards to this Windows app at `http://127.0.0.1:4317/api/slack/oauth/callback`. An IT-managed HTTPS reverse proxy/tunnel can do this. It must preserve the configured callback Host header. Register that **exact HTTPS URL** in Slack's Redirect URLs. Slack requires HTTPS for this OAuth callback; a public static webpage alone cannot exchange the code securely. Keep other app paths local; the server rejects external Host headers except this callback path. Use a separate callback destination per local installation.
5. Copy `slack-config.example.env` to **slack-config.env**. Privately fill in **SLACK_CLIENT_ID**, **SLACK_CLIENT_SECRET** from Basic Information and **SLACK_REDIRECT_URI**. Leave the workspace/channel defaults; the workspace team ID is optional. Never put the client secret in HTML or send it in chat. The actual config file is gitignored, but contains a plaintext app secret: keep it on the trusted Windows account and exclude it from shared ZIPs.
6. Restart **Start BeauSana.cmd**. Select **Connect Slack**, sign in to QuaverEd and approve the requested permissions. The callback exchanges the code on the server, validates the workspace/user and returns to the original local browser session using a short-lived, one-use ticket. The user token never appears in the browser response.

The app's UI/server limits access to the configured channel and the user's DMs. Slack OAuth permissions themselves cover more conversations available to that user; they cannot be scoped to just one channel. No admin, email-address, channel-join, channel-management or bot-impersonation permission is requested. No Events API subscription or incoming webhook is required. Slack API rate limits are announced; sends/uploads are not automatically retried because that could create duplicates. File sharing uses [Slack's external upload flow](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/) and completion, rather than retired `files.upload`. See [Slack OAuth setup](https://docs.slack.dev/authentication/installing-with-oauth/).

Local connections initially last eight hours. Each page provides **Keep connections active for eight more hours**, repeatable without a fixed limit, plus a status warning within the final ten minutes. Unfinished drafts remain only in the page's memory; copy important drafts before reloading. Slack workspace retention, external file-provider permissions and organization policies still apply.

**Remember my Slack connection** encrypts the user/refresh credentials with Windows DPAPI in `%LOCALAPPDATA%\BeauSana\Slack\token.dpapi`. Restore using **Use saved Slack connection**. Disconnect retains the saved credential; Forget deletes it on this PC and disconnects app sessions, but does not revoke Slack authorization. Revoke the app in Slack when needed. Token rotation is supported when enabled for the Slack app. The client ID/secret/callback remain administrator configuration; saved user credentials do not replace them.

### Downloads and references

Slack **Download** and native Asana **Save to computer** save up to 25 MiB to `%USERPROFILE%\Downloads\BeauSana`, using unique filenames. The resulting **Show in Explorer** button selects the actual saved file in Windows Explorer. It never runs the downloaded file. The Downloads page lists files from the current local app session; files remain on disk after restarting. External provider attachments must be accessed in their provider. Ordinary browser downloads continue to use the browser's own download list, not the app's Explorer button.

Quick links reserve **Live, Alpha, Beta, Dev and Patch** without inventing URLs. When the spreadsheet is ready, add entries to `public/quick-links.json` using `{"name":"Live","url":"https://your-real-server/"}`. Only safe web links are rendered.

The searchable component library covers the [30 current APG patterns](https://www.w3.org/WAI/ARIA/apg/patterns/), with short keyboard, screen-reader, ARIA and JavaScript notes. Expand **Official examples** to open the actual W3C examples. **Copy APG link** copies the relevant pattern; a selected text field provides a Ctrl+C fallback if clipboard access fails. These are comparison references, not 30 locally reimplemented widgets. The window-splitter pattern currently lacks a completed APG example. JAWS Surf's Up training links are included; some training pages deliberately contain problematic markup and older browser instructions.

This version is a local app, not a multi-user hosted service. Windows Explorer support requires the local Windows process. A shared web deployment would need separate user sessions, encrypted server-side credentials and a local download helper before it could provide that feature.

## Start on Windows

1. Install Node.js 22 or newer if it is not already installed.
2. Select **Start BeauSana.cmd** in File Explorer and press **Enter**. Keep the terminal window open while using the app.
3. Your browser opens at **http://127.0.0.1:4317** once the server is ready.
4. Choose **Asana tasks**, then **Try with example tasks**, or **Slack messages**, then **Try example conversations**, to explore without connecting an account.
5. To use real tasks, create a personal access token from **the contractor's own Asana account** at [Asana's developer console](https://app.asana.com/0/my-apps), paste it into the password field, and choose **Connect to Asana**. If multiple workspaces are available, choose the right one.

Alternatively, run `npm start` in this folder. No package installation is required. To move the app to another Windows computer, copy this folder; Node.js must be installed there too.

### Remember the token and install updates

Select **Remember my token on this computer** before connecting. After Asana accepts the token, Windows DPAPI encrypts it for the current Windows account in `%LOCALAPPDATA%\BeauSana\token.dpapi`. The app reconnects automatically when its page opens, without sending the saved token to the browser. Windows PowerShell must be available; if saving fails, the app connects for the current session and announces that the token was not saved. Any previously saved token remains unchanged. There is no plaintext fallback. A revoked token must be replaced with a valid one.

**Disconnect** ends the current connection but keeps the saved token. **Forget saved token** deletes the saved credential and disconnects all local app sessions. Connecting with a typed token and leaving Remember unchecked also removes the previous saved token. Forgetting does not revoke the token in Asana or remove any copy in Chrome's password manager.

The saved file is outside the app folder and ZIP, so updates preserve it. To update, stop the command window with Ctrl+C, extract the latest ZIP, copy all extracted files and the public folder over the old version, then start the app and refresh the browser. Include the new `credentials.mjs` file. Do not share or copy the saved token file. When moving to another Windows account or computer, enter the token again.

Windows user encryption protects the stored file, but applications running as that Windows user may also decrypt it. This is not a claim of stronger protection than Chrome's password manager. Secure the Windows account and computer. See [Microsoft's DPAPI documentation](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).

## Workflow with JAWS

- Use your usual browser with JAWS. Chrome or Edge is a reasonable starting point for a Windows trial; this app has not yet been tested with JAWS.
- Use headings to find **My tasks**, then use links or Tab to open a task.
- Opening instructions moves focus to the task heading. **Back to my tasks** restores focus to the task link.
- Loading, task counts, and errors are announced through live regions.
- Refresh fetches the current list. There is no background polling, unexpected navigation, or drag-and-drop.
- Standard controls, visible focus, high contrast support, responsive layout, and text labels are used throughout. JAWS's own mode and shortcut settings still apply.
- Under **Work on this task**, expand the action you need. Text and file inputs have labels, and success or failure is announced. Unsubmitted drafts stay in memory while you reload the same task; switching tasks, disconnecting, or refreshing the browser can clear them.

## What it includes

- Only unfinished tasks assigned to the token owner, in the selected workspace.
- All API pages are fetched, then tasks are sorted by due date, with undated tasks last.
- Task title, due date/time, project, parent task name, and instructions with safe rich-text formatting and links.
- An optional link to open the task in Asana for other actions.
- Comments with safe rich-text formatting and links. Plain `http://`, `https://`, and `www.` URLs are clickable; existing labeled Asana links are preserved. Links open in a new tab and include that information in their accessible names. Script URLs, executable markup, and original HTML attributes are not rendered.
- **Attached files** lists existing task attachments with download links. Asana download URLs are refreshed at click time and verified against the assigned task. Cloud-provider attachments may open their provider instead of downloading directly and may require provider sign-in. Uploaded files appear in the list immediately.
- **Add to the description** appends your text and preserves the original rich text in Asana. If the description changed since you opened it, the app keeps your draft and asks you to reload before submitting. Asana's read/update API does not make this comparison atomic; simultaneous edits from another Asana client can still race with an update.
- **Make a comment** posts a new task comment as the connected user.
- **Mention a person in a comment:** type `@` and part of their name. Tab to a **Mention [name]** suggestion and press Enter. Focus returns to the comment field. Selected names are announced and posted as real Asana mention links. Escape closes suggestions. Editing or deleting a selected name removes its tag. Unselected `@name` text remains plain text.
- Mention suggestions use Asana's workspace typeahead and obey the connected account's access. Before posting, selected people are added as task collaborators, then the app waits three seconds before posting the rich comment, as required by [Asana's notification guidance](https://developers.asana.com/docs/rich-text#triggering-an--mention-notification). This can give the selected people access to the task. Their Asana notification preferences still govern delivery. If a post fails after collaborators were added, they may remain collaborators; check the task before retrying.
- **Upload a file** attaches one non-empty file of up to 25 MiB. Files are relayed in memory to Asana, never saved by this app. Uploaded files are shared with people who can access the task. File names with non-ASCII characters are URL-encoded for Asana's upload API.
- **Hand back the task** uses the previous assignee when available. For a first assignment, it falls back to the person who initially assigned the task, then the task creator. If assignment history is unavailable, Asana's `assigned_by` and creator fields provide the fallback. It avoids assigning back to the connected user. The button identifies the recipient and explains the source, verifies the recipient again before submitting, and removes the task from your list after reassignment. Reassignment does not mark the task complete.
- **Complete this task** marks the task complete in Asana and removes it from the unfinished list after confirmation. A failed or uncertain save keeps the task visible. Reopen a task in Asana if you need to undo completion. For an Asana approval task, marking complete also approves it, as defined by [Asana's task API](https://developers.asana.com/reference/updatetask).
- Demo mode with clearly labeled, fictional tasks. All actions can be tried on examples; demo file uploads display the file name without reading or sending its contents. Demo changes reset when you start a new demo or reload the browser.

The app does not yet display dependencies or custom fields, render embedded images or media, or edit existing comments. Actions obey the connected user's Asana permissions. If an update's outcome cannot be confirmed, check the task in Asana before resubmitting to avoid duplicate comments, files, or additions.

## Credentials and data

The server listens only on `127.0.0.1`, never on the local network. The token is kept in server memory while connected; remembering it stores only Windows-encrypted data on disk. It is never placed in browser storage, a URL, a log, or process arguments. The browser receives only a random HttpOnly, SameSite session cookie. Disconnecting, stopping the server, or reaching the eight-hour session expiry clears the connection; the saved credential remains until forgotten. The app sends the token only to Asana's HTTPS API; the local browser connection uses loopback HTTP. Task data stays in application memory while displayed, and responses use `Cache-Control: no-store`.

A token inherits its owner's Asana access; this interface filtering is not a replacement for Asana permissions. Never use an administrator's token for the contractor. See [Asana's token documentation](https://developers.asana.com/docs/personal-access-token). Personal tokens are a practical local prototype setup; a reusable app distributed to multiple people should use [Asana OAuth](https://developers.asana.com/docs/oauth) and an appropriate credential store. Some organizations restrict token creation.

## Gmail Simple bookmarklet

Open `gmail-bookmarklet.html` in a browser for installation and usage instructions. The bookmarklet hides Gmail's extra panels and stars, and simplifies open-message controls while keeping Inbox, message navigation, attachments, and replies available. Select the bookmark again or choose **Show full Gmail** to restore the view. Reloading Gmail removes the changes.

For JAWS, refresh the virtual buffer with **Insert+Esc** in desktop layout or **Caps Lock+Esc** in laptop layout. The bookmarklet has not been verified in a signed-in Gmail account or with JAWS; message filtering expects English control labels.

Hidden regions receive `aria-hidden="true"`, `inert`, inline hiding, and `tabindex="-1"` on focusable controls. The bookmarklet reapplies these when Gmail rerenders controls and restores their original attributes when switched off. This handling is intended to prevent screen-reader and keyboard access to hidden panels; a live JAWS trial is still required.

To host the installer on a website, upload `gmail-bookmarklet.html`. Upload `gmail-simple.js` beside it for the optional readable-source link. No BeauSana server is needed. After changing the source, regenerate the installer with `node scripts/build-gmail-bookmarklet.mjs`; users must replace their saved bookmark to receive updates.

## App validation

Run `npm test` for API, OAuth/session, download security and Windows credential tests with simulated Slack/Asana responses. To run DOM interaction tests, install development dependencies with `npm ci`, then run `npm run test:ui`. Runtime use still needs only Node.js; no package installation is required. DOM tests cover Slack reactions/threads/drafts, an in-flight send during navigation, component filtering/copy fallback, resource-link safety and Asana Back/Forward.

Live Slack verification needs the configured app and user authorization. A real JAWS trial is required before claiming screen-reader compatibility: check headings/landmarks, connecting, conversations and threads, Back/Forward, message responses, file upload/download/Explorer, clipboard fallback, long messages, errors and disconnect with his JAWS settings. Gmail is outside this dashboard's scope; the earlier standalone bookmarklet files remain available.
