/**
 * Cloud credentials.
 *
 * These are **not secrets**. A browser client ID and API key are visible in
 * the page source by design. Authorised origins protect the OAuth client; the
 * Picker key must be restricted to the Google Picker API, but cannot be bound
 * reliably to this page's referrer because Picker runs in a Google iframe.
 * See the setup guide for the quota implications.
 *
 * Leave a value empty and the corresponding provider simply does not appear in
 * the interface.
 *
 * See docs/CLOUD-SETUP.md for how to obtain these.
 */
export const GOOGLE = {
  /** OAuth 2.0 Client ID, type "Web application". */
  clientId: '56804105563-ku0c9g08f1k32naap7o8i02luogimdr1.apps.googleusercontent.com',
  /** Browser API key, restricted to the Google Picker API. */
  apiKey: 'AIzaSyBUL0k3y-j5Jzv1SFqw9LOh0CKnyUZqzZ0',
  /**
   * The Cloud project *number* (not the project ID) — the digits in front of
   * the dash in `clientId` above, and the same value the console dashboard
   * shows. The picker passes it as the app id, which is how a file the user
   * chooses becomes reachable under the `drive.file` scope.
   */
  appId: '56804105563',
}
