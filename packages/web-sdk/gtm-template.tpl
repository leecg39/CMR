___TERMS_OF_SERVICE___
By creating or modifying this file you agree to Google Tag Manager's Community Template Gallery Developer Terms of Service.
___INFO___
{"type":"TAG","id":"cmp_consent_v1","version":1,"securityGroups":[],"displayName":"이음 Consent Mode","description":"Consent Initialization 기본 거부 및 검증된 선택 적용","containerContexts":["WEB"]}
___TEMPLATE_PARAMETERS___
[{"type":"SELECT","name":"command","displayName":"실행 시점","selectItems":[{"value":"default","displayValue":"기본 거부"},{"value":"update","displayValue":"검증된 선택 갱신"}],"simpleValueType":true,"defaultValue":"default"},{"type":"CHECKBOX","name":"analytics","checkboxText":"분석 허용","simpleValueType":true,"defaultValue":false},{"type":"CHECKBOX","name":"advertising","checkboxText":"광고 허용","simpleValueType":true,"defaultValue":false}]
___SANDBOXED_JS_FOR_WEB_TEMPLATE___
const setDefaultConsentState = require('setDefaultConsentState');
const updateConsentState = require('updateConsentState');
if (data.command === 'default') {
  setDefaultConsentState({analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
} else {
  updateConsentState({analytics_storage:data.analytics ? 'granted':'denied',ad_storage:data.advertising ? 'granted':'denied',ad_user_data:data.advertising ? 'granted':'denied',ad_personalization:data.advertising ? 'granted':'denied'});
}
data.gtmOnSuccess();
___WEB_PERMISSIONS___
[{"instance":{"key":{"publicId":"access_consent","versionId":"1"},"param":[{"key":"consentTypes","value":{"type":2,"listItem":[{"type":3,"mapKey":["consentType","read","write"],"mapValue":[{"type":1,"string":"analytics_storage"},{"type":8,"boolean":false},{"type":8,"boolean":true}]},{"type":3,"mapKey":["consentType","read","write"],"mapValue":[{"type":1,"string":"ad_storage"},{"type":8,"boolean":false},{"type":8,"boolean":true}]},{"type":3,"mapKey":["consentType","read","write"],"mapValue":[{"type":1,"string":"ad_user_data"},{"type":8,"boolean":false},{"type":8,"boolean":true}]},{"type":3,"mapKey":["consentType","read","write"],"mapValue":[{"type":1,"string":"ad_personalization"},{"type":8,"boolean":false},{"type":8,"boolean":true}]}]}}]},"isRequired":true}]
