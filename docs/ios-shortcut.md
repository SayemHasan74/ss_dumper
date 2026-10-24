# Upload to Dump from an iPhone

Use your deployed HTTPS Dump address. Open **Settings → iPhone Shortcut** in Dump and press **Copy Upload URL**. You also need the separate upload token saved in your password manager. This is not the sign-in key or `UPLOAD_TOKEN_HASH`. The app never displays or stores the token. No card or paid service is needed.

Build these shortcuts in Apple's Shortcuts app. Labels can vary slightly by iOS version. This project supplies instructions, not an imported/signed `.shortcut` file. Apple's [Get Contents of URL guide](https://support.apple.com/en-gb/guide/shortcuts/apd58d46713f/ios) explains the underlying request action. The exact headers and upload body below are Dump's API contract.

## Shortcut A: Dump in the Share Sheet

1. Open **Shortcuts**, tap **+**, and name the shortcut **Dump**. Open its details, enable **Show in Share Sheet**, and accept **Images** and **PDFs** (also **Media**, if offered).
2. Add **Repeat with Each**, with **Shortcut Input** as its input. Put steps 3–8 inside this repeat.
3. Add **Get Details of Files**, choose **File Extension**, and set its input to **Repeat Item**. Add **If** the extension is `heic` **or** `heif` (two nested checks can be used if the editor has no “or”). In that branch, **Convert Image** from **Repeat Item** to **JPEG**, quality **High**, and **Set Variable** `UploadFile` to the converted image. In **Otherwise**, set `UploadFile` to **Repeat Item**. End the If block. Both extensions must use the JPEG branch.
4. Add **Get Details of Files**, choose **Name**, input `UploadFile`. Add **URL Encode** for that name and set variable `EncName` to its result. Do not encode the whole Upload URL or token.
5. If a **Hash** action is available, hash the actual `UploadFile` using **SHA256** and save the hexadecimal result as `Sha`. This is optional; if unavailable, omit both this action and the SHA header below. Without a SHA, this route does not detect duplicate uploads. Hash the converted file, not the original HEIC.
6. Add **Get Contents of URL** and paste the Upload URL copied from Dump, such as `https://YOUR-APP.workers.dev/api/upload`. Expand its options and choose **POST**.
7. Add these headers, using the variables rather than typing their names as plain text:

   | Header | Value |
   | --- | --- |
   | `Authorization` | `Bearer ` followed by your upload token; exactly one space after Bearer |
   | `X-File-Name` | `EncName` |
   | `X-Content-Sha256` | `Sha`, only if step 5 was added |
   | `Content-Type` | `application/octet-stream` |

8. Set **Request Body** to **File**, with `UploadFile` as its value. Do not use Form, JSON or Base64. The server requires Content-Length; if the iPhone returns 411, follow the File-body troubleshooting below. Do not add cookies or the sign-in key; bearer authentication is sufficient.
9. Add **Get Dictionary Value**, key `ok`, from the URL result. If it is not true, get dictionary key `error`, then its `message`, and use **Show Notification** to display that message. Close this If, then **End Repeat**.
10. After the repeat, add **Show Notification** with **Sent to Dump**. This final notification means the loop finished; check any per-file error notifications too. Optionally stop the shortcut on the first failure if you prefer.
11. Test with one screenshot: Photos → Share → Dump. Then test several screenshots and a PDF. Open Dump afterward; image thumbnails are generated automatically by its background backfill job. The Shortcut does not upload thumbnails.

## Shortcut B: Dump latest screenshots

1. Create another shortcut named **Dump latest screenshots**.
2. Add **Find Photos**. Filter **Album is Screenshots**, sort by **Creation Date**, **Latest First**, and enable **Limit: 5** (change the count as needed).
3. Feed those photos into the same **Repeat with Each** block from Shortcut A, including conversion, encoded names, optional SHA, File POST and error notifications.
4. Add the final **Sent to Dump** notification. Assign this shortcut to the Action Button, Back Tap, a widget or Home Screen using the options supported by your iPhone.

## Test the upload token separately

1. Create a temporary shortcut with one **Get Contents of URL** action.
2. Set URL to your Dump origin plus `/api/auth/session`, method **GET**.
3. Add `Authorization: Bearer YOUR_UPLOAD_TOKEN` and run it. The result must include `"ok": true` and `"scope": "upload"`. No sign-in cookie is required.
4. The token can access upload/check/thumbnail endpoints and this session check. It cannot list, read or delete your files.

## Permissions, privacy and rotation

The first run may ask to allow network access to your domain and access to Photos. Allow those for your own shortcut. Files may be at most 25 MiB; supported originals are PNG, JPEG, WebP, GIF and PDF. HEIC/HEIF must be converted as above.

The upload token is stored inside the Shortcut. **Never share a configured Shortcut through an iCloud link or send screenshots containing the token.** Keep the sign-in key out of it. To rotate a leaked token, run this locally:

```sh
node scripts/generate-secrets.mjs --only=upload
npx wrangler secret put UPLOAD_TOKEN_HASH
```

Save the newly printed upload token in your password manager. Paste the corresponding hash into Wrangler's secret prompt, and replace the token in both Shortcuts and any token-test shortcut. Do not commit either value. Updating the upload token does not rotate your sign-in key.

## Troubleshooting

| Response | What to do |
| --- | --- |
| 401 | Check for a missing/wrong token, a pasted hash instead of the token, or extra spaces around `Bearer TOKEN`. |
| 403 | The upload-only token was used on a read/list/delete route. Use `/api/upload` or the session-test endpoint. |
| 411 | Content-Length is missing. Set Request Body to **File**, not Form or JSON. Verify this on the actual iPhone; don't guess a length or encode the body as text. |
| 413 | The file exceeds 25 MiB. Choose a smaller file. |
| 415 | Unsupported file type. Ensure HEIC/HEIF is converted to JPEG before upload. |
| 429 with `DAILY_LIMIT` | Daily storage-operation quota is exhausted. Try again after **06:00 Dhaka time (00:00 UTC)**. |
| 429 with `RATE_LIMITED` | Check the token, then wait for the reported Retry-After interval. This is different from daily storage quota. |
| 507 | Storage is nearly full. Delete files or empty Trash from the web app. |

If a photo is uploaded but has no thumbnail yet, leave the signed-in app open and online for a few seconds. Backfill runs only while visible, online and not uploading. Very large images above the backfill limit (15 MiB) keep a placeholder. Real iPhone execution, File-body Content-Length, HEIC conversion and Photos permissions require an on-device test; Windows browser tests cannot confirm them.
