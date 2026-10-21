const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const template = readFileSync(require.resolve('../template.tpl'), 'utf8');
const source = template.split('___SANDBOXED_JS_FOR_SERVER___')[1]
    .split('___SERVER_PERMISSIONS___')[0];
const hash = value => createHash('sha256').update(value).digest('hex');
const firstNameHash = hash('mike');
const lastNameHash = hash('smith');
const ipHash = hash('192.0.2.1');

function runTemplate(event = {}, overrides = {}) {
    const requests = [];
    const logs = [];
    const callbacks = { success: 0, failure: 0 };
    const apis = {
        sendHttpRequest: (url, options, body) => {
            requests.push({ url, options, body: JSON.parse(body) });
            return {
                then: callback => {
                    callback({ statusCode: 201 });
                    return { catch: () => {} };
                }
            };
        },
        getTimestampMillis: () => 1790000000000,
        getAllEventData: () => event,
        getEventData: key => event[key],
        Math,
        JSON,
        makeString: String,
        makeNumber: Number,
        logToConsole: message => logs.push(message),
        sha256Sync: hash,
        getType: value => Array.isArray(value) ? 'array' : typeof value,
        encodeUriComponent: encodeURIComponent,
        makeTableMap: rows => Object.fromEntries(rows.map(row => [row.name, row.value]))
    };
    runInNewContext('(function () {\n' + source + '\n})();', {
        require: name => {
            assert.ok(Object.hasOwn(apis, name), `Unexpected sandbox API: ${name}`);
            return apis[name];
        },
        data: {
            apiAccessToken: 'test-token',
            conversionRuleUrn: '123',
            gtmOnSuccess: () => { callbacks.success += 1; },
            gtmOnFailure: () => { callbacks.failure += 1; },
            ...overrides
        }
    });
    return { requests, logs, callbacks };
}

test('hashed overrides reach the API unchanged and take precedence over event hashes', () => {
    const { requests } = runTemplate({
        hashedFirstName: hash('other'),
        hashedLastName: hash('person'),
        user_data: { sha256_ip_address: hash('192.0.2.2') }
    }, {
        userInfo: [
            { name: 'hashedFirstName', value: firstNameHash },
            { name: 'hashedLastName', value: lastNameHash }
        ],
        userIds: [{ name: 'hashedIpAddress', value: ipHash }]
    });
    assert.equal(requests.length, 1);
    const { body, options } = requests[0];
    assert.equal(options.headers['LinkedIn-Version'], '202610');
    assert.equal(body.user.userInfo.hashedFirstName, firstNameHash);
    assert.equal(body.user.userInfo.hashedLastName, lastNameHash);
    assert.equal(body.user.userInfo.firstName, undefined);
    assert.equal(body.user.userInfo.lastName, undefined);
    assert.deepEqual(body.user.userIds, [{ idType: 'SHA256_IP_ADDRESS', idValue: ipHash }]);
});

test('hashed names alone qualify a conversion from every supported event source', () => {
    const names = { sha256_first_name: firstNameHash, sha256_last_name: lastNameHash };
    const events = [
        { hashedFirstName: firstNameHash, hashedLastName: lastNameHash },
        { user_data: names },
        { user_data: { address: names } },
        { user_data: { address: [names] } }
    ];
    for (const event of events) {
        const { requests } = runTemplate(event);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.user.userInfo.hashedFirstName, firstNameHash);
        assert.equal(requests[0].body.user.userInfo.hashedLastName, lastNameHash);
        assert.deepEqual(requests[0].body.user.userIds, []);
    }
});

test('event hashed names take precedence over user data and address hashes', () => {
    const { requests } = runTemplate({
        hashedFirstName: firstNameHash,
        user_data: {
            sha256_first_name: hash('other'),
            sha256_last_name: lastNameHash,
            address: { sha256_last_name: hash('person') }
        }
    });
    assert.equal(requests[0].body.user.userInfo.hashedFirstName, firstNameHash);
    assert.equal(requests[0].body.user.userInfo.hashedLastName, lastNameHash);
});

test('both combinations of plaintext and hashed names qualify a conversion', () => {
    for (const event of [
        { firstName: 'Mike', hashedLastName: lastNameHash },
        { hashedFirstName: firstNameHash, lastName: 'Smith' }
    ]) {
        const { requests } = runTemplate(event);
        assert.equal(requests.length, 1);
        for (const [name, value] of Object.entries(event)) {
            assert.equal(requests[0].body.user.userInfo[name], value);
        }
    }
});

test('hashed IP alone qualifies a conversion and coexists with plaintext IP', () => {
    for (const ip of [undefined, '192.0.2.1']) {
        const { requests } = runTemplate({
            ip_override: ip,
            user_data: { sha256_ip_address: ipHash }
        });
        assert.equal(requests.length, 1);
        const ids = requests[0].body.user.userIds;
        assert.ok(ids.some(id => id.idType === 'SHA256_IP_ADDRESS' && id.idValue === ipHash));
        assert.equal(ids.some(id => id.idType === 'PLAINTEXT_IP_ADDRESS'), !!ip);
        assert.equal(requests[0].body.user.userInfo, undefined);
    }
});

test('incomplete hashed name pairs do not send userInfo or qualify without an identifier', () => {
    for (const names of [
        { hashedFirstName: firstNameHash },
        { hashedLastName: lastNameHash }
    ]) {
        const withoutId = runTemplate(names);
        assert.equal(withoutId.requests.length, 0);
        assert.equal(withoutId.logs.length, 1);
        assert.equal(withoutId.callbacks.failure, 1);
        const withId = runTemplate({ ...names, user_data: { sha256_ip_address: ipHash } });
        assert.equal(withId.requests.length, 1);
        assert.equal(withId.requests[0].body.user.userInfo, undefined);
        assert.equal(withId.callbacks.success, 1);
        assert.equal(withId.callbacks.failure, 0);
    }
});

test('existing plaintext names and identifiers remain unchanged', () => {
    const { requests } = runTemplate({
        user_data: {
            email_address: 'Mike@example.com',
            address: { first_name: 'Mike', last_name: 'Smith', country: 'US' }
        },
        ip_override: '192.0.2.1'
    });
    assert.deepEqual(requests[0].body.user.userInfo, {
        firstName: 'Mike',
        lastName: 'Smith',
        title: '',
        companyName: '',
        countryCode: 'US'
    });
    assert.deepEqual(requests[0].body.user.userIds, [
        { idType: 'SHA256_EMAIL', idValue: hash('mike@example.com') },
        { idType: 'PLAINTEXT_IP_ADDRESS', idValue: '192.0.2.1' }
    ]);
});

test('invalid hash formats are omitted and logged without exposing their values', () => {
    for (const value of [
        'a'.repeat(63),
        'a'.repeat(65),
        'g'.repeat(64),
        ' ' + firstNameHash,
        firstNameHash + '\n',
        'Mike',
        [firstNameHash],
        { hash: firstNameHash },
        123
    ]) {
        const { requests, logs } = runTemplate({
            firstName: 'Mike',
            lastName: 'Smith',
            hashedFirstName: value,
            hashedLastName: value,
            user_data: { sha256_ip_address: value }
        });
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].body.user.userIds, []);
        assert.equal(requests[0].body.user.userInfo.hashedFirstName, undefined);
        assert.equal(requests[0].body.user.userInfo.hashedLastName, undefined);
        assert.deepEqual(logs.sort(), [
            'hashedFirstName', 'hashedIpAddress', 'hashedLastName'
        ].map(name => `Ignoring invalid SHA256 format for ${name}: expected exactly 64 hexadecimal characters.`).sort());
    }
});

test('invalid hashes cannot qualify a conversion without other valid user data', () => {
    for (const event of [
        { hashedFirstName: 'invalid', hashedLastName: lastNameHash },
        { hashedFirstName: firstNameHash, hashedLastName: 'invalid' },
        { user_data: { sha256_ip_address: 'invalid' } }
    ]) {
        const { requests, logs, callbacks } = runTemplate(event);
        assert.equal(requests.length, 0);
        assert.equal(callbacks.failure, 1);
        assert.equal(callbacks.success, 0);
        assert.ok(logs.some(message => message.startsWith('Ignoring invalid SHA256 format')));
        assert.ok(logs.some(message => message.startsWith('No conversion event was sent')));
    }
});

test('invalid overrides are not replaced by lower-priority event hashes', () => {
    const { requests, logs } = runTemplate({
        firstName: 'Mike',
        lastName: 'Smith',
        hashedFirstName: firstNameHash,
        hashedLastName: lastNameHash,
        user_data: { sha256_ip_address: ipHash }
    }, {
        userInfo: [
            { name: 'hashedFirstName', value: 'invalid' },
            { name: 'hashedLastName', value: 'invalid' }
        ],
        userIds: [{ name: 'hashedIpAddress', value: 'invalid' }]
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.user.userIds, []);
    assert.equal(requests[0].body.user.userInfo.hashedFirstName, undefined);
    assert.equal(requests[0].body.user.userInfo.hashedLastName, undefined);
    assert.equal(logs.length, 3);
});

test('uppercase hexadecimal hashes are accepted unchanged', () => {
    const { requests, logs } = runTemplate({
        hashedFirstName: firstNameHash.toUpperCase(),
        hashedLastName: lastNameHash.toUpperCase(),
        user_data: { sha256_ip_address: ipHash.toUpperCase() }
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.user.userInfo.hashedFirstName, firstNameHash.toUpperCase());
    assert.equal(requests[0].body.user.userInfo.hashedLastName, lastNameHash.toUpperCase());
    assert.deepEqual(requests[0].body.user.userIds, [
        { idType: 'SHA256_IP_ADDRESS', idValue: ipHash.toUpperCase() }
    ]);
    assert.deepEqual(logs, []);
});
