# linkedin-capi-tag-template
LinkedIn's official Google Tag Manager tag template for streaming conversion events from server container to LinkedIn's Conversions API endpoint.

## Hashed identifiers

`template.tpl` sends conversion events using LinkedIn API version `202610`.
In **User Info Override**, select **Hashed First Name (SHA256)** or
**Hashed Last Name (SHA256)**. In **User Ids Override**, select
**SHA256_IP_ADDRESS**.

Hashes must be supplied as 64-character hexadecimal SHA256 strings and are sent
unchanged, not hashed again. Before hashing names, lowercase them, remove spaces
and punctuation, and encode special characters as UTF-8. Hashed IP addresses must
be derived from IPv4 addresses.

Without overrides, hashed names are read from `hashedFirstName` /
`hashedLastName` on the event, then `user_data.sha256_first_name` /
`user_data.sha256_last_name`, then the same `sha256_*` fields under
`user_data.address` (an object or the first entry of an array). Hashed IP is read
from `user_data.sha256_ip_address`. Overrides take precedence over these sources.

User info requires both a first and last name, each of which may be plaintext or
hashed. Existing plaintext name and IP collection is unchanged; plaintext and
hashed fields may coexist.

Hashed names and IP addresses are checked against `^[A-Fa-f0-9]{64}$` and must
be strings. Invalid values are omitted with a diagnostic log that does not
include the supplied value. The selected override or event value is validated;
an invalid override does not fall back to lower-priority sources. Valid
identifiers and plaintext names remain usable. If no valid identifier or complete
name pair remains, no event is sent and the tag calls `gtmOnFailure`.

See the [Conversions API schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema?view=li-lms-2026-10#streaming-conversion-events-api-schema).
Run the local payload regression tests with `node --test tests/template.test.js`.
These mock the GTM server APIs; use the GTM template editor for sandbox validation.

## LinkedIn Developer documentation
https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api

## Google Developer documentation
https://developers.google.com/tag-platform/tag-manager/templates/gallery

## Add to workspace from Community Template Gallery
https://tagmanager.google.com/gallery/#/owners/linkedin-developers/templates/linkedin-capi-tag-template

## Template status in Community Template Gallery
https://tagmanager.google.com/gallery/#/template/linkedin-developers/linkedin-capi-tag-template/status
