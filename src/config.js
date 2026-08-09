/**
 * Cloud credentials.
 *
 * These are **not secrets**. A browser client ID and API key are visible in
 * the page source by design; what protects them is the list of authorised
 * origins and referrers configured on the provider's side. Committing them is
 * normal and expected — but restrict them there, or someone else's site can
 * use your quota.
 *
 * Leave a value empty and the corresponding provider simply does not appear in
 * the interface.
 *
 * See docs/CLOUD-SETUP.md for how to obtain these.
 */
export const GOOGLE = {
  /** OAuth 2.0 Client ID, type "Web application". */
  clientId: '56804105563-ku0c9g08f1k32naap7o8i02luogimdr1.apps.googleusercontent.com',
  /** API key, restricted by HTTP referrer, used by the file picker. */
  apiKey: 'AIzaSyBUL0k3y-j5Jzv1SFqw9LOh0CKnyUZqzZ0',
  /**
   * The Cloud project *number* (not the project ID) — the digits in front of
   * the dash in `clientId` above, and the same value the console dashboard
   * shows. The picker passes it as the app id, which is how a file the user
   * chooses becomes reachable under the `drive.file` scope.
   */
  appId: '56804105563',
}
