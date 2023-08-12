import React, {
  useEffect, useMemo, useState,
} from 'react';
import { connect } from 'react-redux';

import { getConfig, snakeCaseObject } from '@edx/frontend-platform';
import { sendPageEvent } from '@edx/frontend-platform/analytics';
import {
  getCountryList, getLocale, useIntl,
} from '@edx/frontend-platform/i18n';
import { Form, Spinner, StatefulButton } from '@edx/paragon';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import { Helmet } from 'react-helmet';
import Skeleton from 'react-loading-skeleton';

import ConfigurableRegistrationForm from './ConfigurableRegistrationForm';
import {
  backupRegistrationFormBegin,
  clearRegistertionBackendError,
  clearUsernameSuggestions,
  fetchRealtimeValidations,
  registerNewUser,
  setUserPipelineDataLoaded,
} from './data/actions';
import {
  COUNTRY_CODE_KEY,
  COUNTRY_DISPLAY_KEY,
  FIELDS,
  FORM_SUBMISSION_ERROR,
  TPA_AUTHENTICATION_FAILURE,
} from './data/constants';
import { registrationErrorSelector, validationsSelector } from './data/selectors';
import {
  getSuggestionForInvalidEmail, validateCountryField, validateEmailAddress,
} from './data/utils';
import messages from './messages';
import RegistrationFailure from './RegistrationFailure';
import { EmailField, UsernameField } from './registrationFields';
import ThirdPartyAuth from './ThirdPartyAuth';
import {
  FormGroup, InstitutionLogistration, PasswordField, RedirectLogistration, ThirdPartyAuthAlert,
} from '../common-components';
import { getThirdPartyAuthContext } from '../common-components/data/actions';
import {
  fieldDescriptionSelector, optionalFieldsSelector, thirdPartyAuthContextSelector,
} from '../common-components/data/selectors';
import EnterpriseSSO from '../common-components/EnterpriseSSO';
import {
  COMPLETE_STATE, DEFAULT_STATE,
  INVALID_NAME_REGEX, LETTER_REGEX, NUMBER_REGEX, PENDING_STATE, REGISTER_PAGE, VALID_EMAIL_REGEX,
} from '../data/constants';
import {
  getAllPossibleQueryParams, getTpaHint, getTpaProvider, isHostAvailableInQueryParams, setCookie,
} from '../data/utils';

const emailRegex = new RegExp(VALID_EMAIL_REGEX, 'i');
const urlRegex = new RegExp(INVALID_NAME_REGEX);

const RegistrationPage = (props) => {
  const {
    backedUpFormData,
    backendCountryCode,
    backendValidations,
    fieldDescriptions,
    handleInstitutionLogin,
    institutionLogin,
    optionalFields,
    registrationError,
    registrationErrorCode,
    registrationResult,
    shouldBackupState,
    submitState,
    thirdPartyAuthApiStatus,
    thirdPartyAuthContext,
    usernameSuggestions,
    validationApiRateLimited,
    // Actions
    backupFormState,
    setUserPipelineDetailsLoaded,
    getRegistrationDataFromBackend,
    userPipelineDataLoaded,
    validateFromBackend,
    clearBackendError,
  } = props;

  const { formatMessage } = useIntl();
  const countryList = useMemo(() => getCountryList(getLocale()), []);
  const queryParams = useMemo(() => getAllPossibleQueryParams(), []);
  const registrationEmbedded = isHostAvailableInQueryParams();
  const { cta, host } = queryParams;
  const tpaHint = useMemo(() => getTpaHint(), []);
  const flags = {
    showConfigurableEdxFields: getConfig().SHOW_CONFIGURABLE_EDX_FIELDS,
    showConfigurableRegistrationFields: getConfig().ENABLE_DYNAMIC_REGISTRATION_FIELDS,
    showMarketingEmailOptInCheckbox: getConfig().MARKETING_EMAILS_OPT_IN,
  };

  const [formFields, setFormFields] = useState({ ...backedUpFormData.formFields });
  const [configurableFormFields, setConfigurableFormFields] = useState({ ...backedUpFormData.configurableFormFields });
  const [errors, setErrors] = useState({ ...backedUpFormData.errors });
  const [emailSuggestion, setEmailSuggestion] = useState({ ...backedUpFormData.emailSuggestion });
  const [autoSubmitRegisterForm, setAutoSubmitRegisterForm] = useState(false);
  const [errorCode, setErrorCode] = useState({ type: '', count: 0 });
  const [formStartTime, setFormStartTime] = useState(null);
  const [focusedField, setFocusedField] = useState(null);

  const {
    providers, currentProvider, secondaryProviders, finishAuthUrl,
  } = thirdPartyAuthContext;
  const providers_temp = ['Google', 'Facebook', 'Github', 'LinkedIn', 'IBMid'] // SN-TODO: Delete this
  const platformName = getConfig().SITE_NAME;
  const buttonLabel = cta ? formatMessage(messages['create.account.cta.button'], { label: cta }) : formatMessage(messages['create.account.for.free.button']);

  /**
   * If auto submitting register form, we will check tos and honor code fields if they exist for feature parity.
   */
  const checkTOSandHonorCodeFields = () => {
    if (Object.keys(fieldDescriptions).includes(FIELDS.HONOR_CODE)) {
      setConfigurableFormFields(prevState => ({
        ...prevState,
        [FIELDS.HONOR_CODE]: true,
      }));
    }
    if (Object.keys(fieldDescriptions).includes(FIELDS.TERMS_OF_SERVICE)) {
      setConfigurableFormFields(prevState => ({
        ...prevState,
        [FIELDS.TERMS_OF_SERVICE]: true,
      }));
    }
  };

  /**
   * Set the userPipelineDetails data in formFields for only first time
   */
  useEffect(() => {
    if (!userPipelineDataLoaded && thirdPartyAuthApiStatus === COMPLETE_STATE) {
      const { autoSubmitRegForm, pipelineUserDetails, errorMessage } = thirdPartyAuthContext;
      if (errorMessage) {
        setErrorCode(prevState => ({ type: TPA_AUTHENTICATION_FAILURE, count: prevState.count + 1 }));
      } else if (autoSubmitRegForm) {
        checkTOSandHonorCodeFields();
        setAutoSubmitRegisterForm(true);
      }
      if (pipelineUserDetails && Object.keys(pipelineUserDetails).length !== 0) {
        const { name = '', username = '', email = '' } = pipelineUserDetails;
        setFormFields(prevState => ({
          ...prevState, name, username, email,
        }));
        setUserPipelineDetailsLoaded(true);
      }
    }
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    thirdPartyAuthContext,
    userPipelineDataLoaded,
    setUserPipelineDetailsLoaded,
  ]);

  useEffect(() => {
    if (!formStartTime) {
      sendPageEvent('login_and_registration', 'register');
      const payload = { ...queryParams, is_register_page: true };
      if (tpaHint) {
        payload.tpa_hint = tpaHint;
      }
      getRegistrationDataFromBackend(payload);
      setFormStartTime(Date.now());
    }
  }, [formStartTime, getRegistrationDataFromBackend, queryParams, tpaHint]);

  /**
   * Backup the registration form in redux when register page is toggled.
   */
  useEffect(() => {
    if (shouldBackupState) {
      backupFormState({
        configurableFormFields: { ...configurableFormFields },
        formFields: { ...formFields },
        emailSuggestion: { ...emailSuggestion },
        errors: { ...errors },
      });
    }
  }, [shouldBackupState, configurableFormFields, formFields, errors, emailSuggestion, backupFormState]);

  useEffect(() => {
    if (backendValidations) {
      setErrors(prevErrors => ({ ...prevErrors, ...backendValidations }));
    }
  }, [backendValidations]);

  useEffect(() => {
    if (registrationErrorCode) {
      setErrorCode(prevState => ({ type: registrationErrorCode, count: prevState.count + 1 }));
    }
  }, [registrationErrorCode]);

  useEffect(() => {
    if (backendCountryCode && backendCountryCode !== configurableFormFields?.country?.countryCode) {
      let countryCode = '';
      let countryDisplayValue = '';

      const selectedCountry = countryList.find(
        (country) => (country[COUNTRY_CODE_KEY].toLowerCase() === backendCountryCode.toLowerCase()),
      );
      if (selectedCountry) {
        countryCode = selectedCountry[COUNTRY_CODE_KEY];
        countryDisplayValue = selectedCountry[COUNTRY_DISPLAY_KEY];
      }
      setConfigurableFormFields(prevState => (
        {
          ...prevState,
          country: {
            countryCode, displayValue: countryDisplayValue,
          },
        }
      ));
    }
  }, [backendCountryCode, countryList]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * We need to remove the placeholder from the field, adding a space will do that.
   * This is needed because we are placing the username suggestions on top of the field.
   */
  useEffect(() => {
    if (usernameSuggestions.length && !formFields.username) {
      setFormFields(prevState => ({ ...prevState, username: ' ' }));
    }
  }, [usernameSuggestions, formFields]);

  useEffect(() => {
    if (registrationResult.success) {
      // Optimizely registration conversion event
      window.optimizely = window.optimizely || [];
      window.optimizely.push({
        type: 'event',
        eventName: 'authn-registration-conversion',
      });

      // We probably don't need this cookie because this fires the same event as
      // above for optimizely using GTM.
      setCookie(getConfig().REGISTER_CONVERSION_COOKIE_NAME, true);
      // This is used by the "User Retention Rate Event" on GTM
      setCookie('authn-returning-user');

      // Fire GTM event used for integration with impact.com
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'ImpactRegistrationEvent',
      });
    }
  }, [registrationResult]);

  const validateInput = (fieldName, value, payload, shouldValidateFromBackend, setError = true) => {
    let fieldError = '';
    let confirmEmailError = ''; // This is to handle the use case where the form contains "confirm email" field
    let countryFieldCode = '';

    switch (fieldName) {
      case 'name':
        if (!value.trim()) {
          fieldError = formatMessage(messages['empty.name.field.error']);
        } else if (value && value.match(urlRegex)) {
          fieldError = formatMessage(messages['name.validation.message']);
        } else if (value && !payload.username.trim() && shouldValidateFromBackend) {
          validateFromBackend(payload);
        }
        break;
      case 'email':
        if (!value) {
          fieldError = formatMessage(messages['empty.email.field.error']);
        } else if (value.length <= 2) {
          fieldError = formatMessage(messages['email.invalid.format.error']);
        } else {
          const [username, domainName] = value.split('@');
          // Check if email address is invalid. If we have a suggestion for invalid email
          // provide that along with the error message.
          if (!emailRegex.test(value)) {
            fieldError = formatMessage(messages['email.invalid.format.error']);
            setEmailSuggestion({
              suggestion: getSuggestionForInvalidEmail(domainName, username),
              type: 'error',
            });
          } else {
            const response = validateEmailAddress(value, username, domainName);
            if (response.hasError) {
              fieldError = formatMessage(messages['email.invalid.format.error']);
              delete response.hasError;
            } else if (shouldValidateFromBackend) {
              validateFromBackend(payload);
            }
            setEmailSuggestion({ ...response });

            if (configurableFormFields.confirm_email && value !== configurableFormFields.confirm_email) {
              confirmEmailError = formatMessage(messages['email.do.not.match']);
            }
          }
        }
        break;
      case 'username':
        if (!value || value.length <= 1 || value.length > 30) {
          fieldError = formatMessage(messages['username.validation.message']);
        } else if (!value.match(/^[a-zA-Z0-9_-]*$/i)) {
          fieldError = formatMessage(messages['username.format.validation.message']);
        } else if (shouldValidateFromBackend) {
          validateFromBackend(payload);
        }
        break;
      case 'password':
        if (!value || !LETTER_REGEX.test(value) || !NUMBER_REGEX.test(value) || value.length < 8) {
          fieldError = formatMessage(messages['password.validation.message']);
        } else if (shouldValidateFromBackend) {
          validateFromBackend(payload);
        }
        break;
      case 'country':
        if (flags.showConfigurableEdxFields || flags.showConfigurableRegistrationFields) {
          const {
            countryCode, displayValue, error,
          } = validateCountryField(value.displayValue.trim(), countryList, formatMessage(messages['empty.country.field.error']));
          fieldError = error;
          countryFieldCode = countryCode;
          setConfigurableFormFields(prevState => ({ ...prevState, country: { countryCode, displayValue } }));
        }
        break;
      default:
        if (flags.showConfigurableRegistrationFields) {
          if (!value && fieldDescriptions[fieldName]?.error_message) {
            fieldError = fieldDescriptions[fieldName].error_message;
          } else if (fieldName === 'confirm_email' && formFields.email && value !== formFields.email) {
            fieldError = formatMessage(messages['email.do.not.match']);
          }
        }
        break;
    }
    if (setError) {
      setErrors(prevErrors => ({
        ...prevErrors,
        confirm_email: flags.showConfigurableRegistrationFields ? confirmEmailError : '',
        [fieldName]: fieldError,
      }));
    }
    return { fieldError, countryFieldCode };
  };

  const isFormValid = (payload, focusedFieldError) => {
    const fieldErrors = { ...errors };
    let isValid = !focusedFieldError;
    Object.keys(payload).forEach(key => {
      if (!payload[key]) {
        fieldErrors[key] = formatMessage(messages[`empty.${key}.field.error`]);
      }
      if (fieldErrors[key]) {
        isValid = false;
      }
    });

    if (flags.showConfigurableEdxFields) {
      if (!configurableFormFields.country.displayValue) {
        fieldErrors.country = formatMessage(messages['empty.country.field.error']);
      }
      if (fieldErrors.country) {
        isValid = false;
      }
    }

    if (flags.showConfigurableRegistrationFields) {
      Object.keys(fieldDescriptions).forEach(key => {
        if (key === 'country' && !configurableFormFields.country.displayValue) {
          fieldErrors[key] = formatMessage(messages['empty.country.field.error']);
        } else if (!configurableFormFields[key]) {
          fieldErrors[key] = fieldDescriptions[key].error_message;
        }
        if (fieldErrors[key]) {
          isValid = false;
        }
      });
    }

    if (focusedField) {
      fieldErrors[focusedField] = focusedFieldError;
    }
    setErrors({ ...fieldErrors });
    return isValid;
  };

  const handleSuggestionClick = (event, fieldName, suggestion = '') => {
    event.preventDefault();
    setErrors(prevErrors => ({ ...prevErrors, [fieldName]: '' }));
    switch (fieldName) {
      case 'email':
        setFormFields(prevState => ({ ...prevState, email: emailSuggestion.suggestion }));
        setEmailSuggestion({ suggestion: '', type: '' });
        break;
      case 'username':
        setFormFields(prevState => ({ ...prevState, username: suggestion }));
        props.resetUsernameSuggestions();
        break;
      default:
        break;
    }
  };

  const handleEmailSuggestionClosed = () => setEmailSuggestion({ suggestion: '', type: '' });

  const handleUsernameSuggestionClosed = () => props.resetUsernameSuggestions();

  const handleOnChange = (event) => {
    const { name } = event.target;
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (registrationError[name]) {
      clearBackendError(name);
      setErrors(prevErrors => ({ ...prevErrors, [name]: '' }));
    }
    if (name === 'username') {
      if (value.length > 30) {
        return;
      }
      if (value.startsWith(' ')) {
        value = value.trim();
      }
    }

    setFormFields(prevState => ({ ...prevState, [name]: value }));
  };

  const handleOnBlur = (event) => {
    const { name, value } = event.target;
    if (registrationEmbedded) {
      if (name === 'name') {
        validateInput(
          name,
          value,
          { name: formFields.name, username: formFields.username, form_field_key: name },
          !validationApiRateLimited,
          false,
        );
      }
      return;
    }
    const payload = {
      name: formFields.name,
      email: formFields.email,
      username: formFields.username,
      password: formFields.password,
      form_field_key: name,
    };

    setFocusedField(null);
    validateInput(name, name === 'password' ? formFields.password : value, payload, !validationApiRateLimited);
  };

  const handleOnFocus = (event) => {
    const { name, value } = event.target;
    setErrors(prevErrors => ({ ...prevErrors, [name]: '' }));
    clearBackendError(name);
    // Since we are removing the form errors from the focused field, we will
    // need to rerun the validation for focused field on form submission.
    setFocusedField(name);

    if (name === 'username') {
      props.resetUsernameSuggestions();
      // If we added a space character to username field to display the suggestion
      // remove it before user enters the input. This is to ensure user doesn't
      // have a space prefixed to the username.
      if (value === ' ') {
        setFormFields(prevState => ({ ...prevState, [name]: '' }));
      }
    }
  };

  const registerUser = () => {
    const totalRegistrationTime = (Date.now() - formStartTime) / 1000;
    let payload = { ...formFields };

    if (currentProvider) {
      delete payload.password;
      payload.social_auth_provider = currentProvider;
    }

    const { fieldError: focusedFieldError, countryFieldCode } = focusedField ? (
      validateInput(
        focusedField,
        (focusedField in fieldDescriptions || ['country', 'marketingEmailsOptIn'].includes(focusedField)) ? (
          configurableFormFields[focusedField]
        ) : formFields[focusedField],
        payload,
        false,
        false,
      )
    ) : '';

    if (!isFormValid(payload, focusedFieldError)) {
      setErrorCode(prevState => ({ type: FORM_SUBMISSION_ERROR, count: prevState.count + 1 }));
      return;
    }

    Object.keys(configurableFormFields).forEach((fieldName) => {
      if (fieldName === 'country') {
        payload[fieldName] = focusedField === 'country' ? countryFieldCode : configurableFormFields[fieldName].countryCode;
      } else {
        payload[fieldName] = configurableFormFields[fieldName];
      }
    });

    // Don't send the marketing email opt-in value if the flag is turned off
    if (!flags.showMarketingEmailOptInCheckbox) {
      delete payload.marketingEmailsOptIn;
    }

    payload = snakeCaseObject(payload);
    payload.totalRegistrationTime = totalRegistrationTime;

    // add query params to the payload
    payload = { ...payload, ...queryParams };
    props.registerNewUser(payload);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    registerUser();
  };

  useEffect(() => {
    if (autoSubmitRegisterForm && userPipelineDataLoaded) {
      registerUser();
    }
  }, [autoSubmitRegisterForm, userPipelineDataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderForm = () => {
    if (institutionLogin) {
      return (
        <InstitutionLogistration
          secondaryProviders={secondaryProviders}
          headingTitle={formatMessage(messages['register.institution.login.page.title'])}
        />
      );
    }
    return (
      <>
        <Helmet>
          <title>{formatMessage(messages['register.page.title'], { siteName: getConfig().SITE_NAME })}</title>
        </Helmet>
        <RedirectLogistration
          host={host}
          success={registrationResult.success}
          redirectUrl={registrationResult.redirectUrl}
          finishAuthUrl={finishAuthUrl}
          optionalFields={optionalFields}
          registrationEmbedded={registrationEmbedded}
          redirectToProgressiveProfilingPage={
            getConfig().ENABLE_PROGRESSIVE_PROFILING_ON_AUTHN && Object.keys(optionalFields).includes('fields')
          }
        />
        {autoSubmitRegisterForm && !errorCode.type ? (
          <div className="mw-xs mt-5 text-center">
            <Spinner animation="border" variant="primary" id="tpa-spinner" />
          </div>
        ) : (
          <div
            className={classNames(
              '',
              { 'w-100 m-auto pt-4 main-content': registrationEmbedded },
            )}
          >
            <ThirdPartyAuthAlert
              currentProvider={currentProvider}
              platformName={platformName}
              referrer={REGISTER_PAGE}
            />
            <RegistrationFailure
              errorCode={errorCode.type}
              failureCount={errorCode.count}
              context={{ provider: currentProvider, errorMessage: thirdPartyAuthContext.errorMessage }}
            />
            <Form id="registration-form" name="registration-form">
              <FormGroup
                name="name"
                value={formFields.name}
                handleChange={handleOnChange}
                handleBlur={handleOnBlur}
                handleFocus={handleOnFocus}
                errorMessage={errors.name}
                helpText={[formatMessage(messages['help.text.name'])]}
                floatingLabel={formatMessage(messages['registration.fullname.label'])}
              />
              <EmailField
                name="email"
                value={formFields.email}
                handleChange={handleOnChange}
                handleBlur={handleOnBlur}
                handleFocus={handleOnFocus}
                handleSuggestionClick={(e) => handleSuggestionClick(e, 'email')}
                handleOnClose={handleEmailSuggestionClosed}
                emailSuggestion={emailSuggestion}
                errorMessage={errors.email}
                helpText={[formatMessage(messages['help.text.email'])]}
                floatingLabel={formatMessage(messages['registration.email.label'])}
              />
              <UsernameField
                name="username"
                className="small-margin-bottom"
                spellCheck="false"
                value={formFields.username}
                handleBlur={handleOnBlur}
                handleChange={handleOnChange}
                handleFocus={handleOnFocus}
                handleSuggestionClick={handleSuggestionClick}
                handleUsernameSuggestionClose={handleUsernameSuggestionClosed}
                usernameSuggestions={usernameSuggestions}
                errorMessage={errors.username}
                helpText={[formatMessage(messages['help.text.username.1']), formatMessage(messages['help.text.username.2'])]}
                floatingLabel={formatMessage(messages['registration.username.label'])}
              />
              {!currentProvider && (
                <PasswordField
                  name="password"
                  value={formFields.password}
                  handleChange={handleOnChange}
                  handleBlur={handleOnBlur}
                  handleFocus={handleOnFocus}
                  errorMessage={errors.password}
                  floatingLabel={formatMessage(messages['registration.password.label'])}
                />
              )}
              {/* Below component ConfigurableRegistrationForm shows up as <div></div> in DOM */}
              <ConfigurableRegistrationForm
                countryList={countryList}
                email={formFields.email}
                fieldErrors={errors}
                registrationEmbedded={registrationEmbedded}
                formFields={configurableFormFields}
                setFieldErrors={setErrors}
                setFormFields={setConfigurableFormFields}
                setFocusedField={setFocusedField}
                fieldDescriptions={fieldDescriptions}
              />
              <div className='contain-and-center'>
                <div id="honor-code">
                  By creating an account, you agree to the <a className='gray-text-light underlined' href='https://apps.cognitiveclass.ai/authn/register?next=%2Foauth2%2Fauthorize%3Fclient_id%3DXCTzu9NHWn%26redirect_uri%3Dhttps%253A%252F%252Fcognitiveclass.ai%252Fauth%252Fopen_edx%252Fcallback%26response_type%3Dcode%26scope%3Duser_id%2Bprofile%2Bemail%26state%3D6b59ac31a83be0265e7085bd29f3fea52a7a0d0d38d36230#'>Terms of Service and Honor Code</a> and you acknowledge that Cognitive Class and each Member 
                  process your personal data in accordance with the <a className='gray-text-light underlined' href='https://apps.cognitiveclass.ai/authn/register?next=%2Foauth2%2Fauthorize%3Fclient_id%3DXCTzu9NHWn%26redirect_uri%3Dhttps%253A%252F%252Fcognitiveclass.ai%252Fauth%252Fopen_edx%252Fcallback%26response_type%3Dcode%26scope%3Duser_id%2Bprofile%2Bemail%26state%3D6b59ac31a83be0265e7085bd29f3fea52a7a0d0d38d36230#'>Privacy Policy</a>.
                </div>
              </div>
              <div className='contain-and-center'>
                <StatefulButton
                  id="register-user"
                  name="register-user"
                  type="submit"
                  variant="brand"
                  className="register-button mt-4 input-form-width"
                  state={submitState}
                  labels={{
                    default: buttonLabel,
                    pending: '',
                  }}
                  onClick={handleSubmit}
                  onMouseDown={(e) => e.preventDefault()}
                />
              </div>
              <div className='contain-and-center'>
                <div className="login-page-box gray-text">
                  Already have an account? <a id='login-page-link'>Log in here</a>
                </div>
              </div>
              {!registrationEmbedded && (
                <div className='mt-4'>
                  <ThirdPartyAuth
                    currentProvider={currentProvider}
                    // providers={providers}    // SN-TODO: Uncomment this
                    providers={providers_temp}  // SN-TODO: Delete this
                    secondaryProviders={secondaryProviders}
                    handleInstitutionLogin={handleInstitutionLogin}
                    thirdPartyAuthApiStatus={thirdPartyAuthApiStatus}
                  />
                </div>
              )}
            </Form>
          </div>
        )}

      </>
    );
  };

  if (tpaHint) {
    if (thirdPartyAuthApiStatus === PENDING_STATE) {
      return <Skeleton height={36} />;
    }
    const { provider, skipHintedLogin } = getTpaProvider(tpaHint, providers, secondaryProviders);
    if (skipHintedLogin) {
      window.location.href = getConfig().LMS_BASE_URL + provider.registerUrl;
      return null;
    }
    return provider ? <EnterpriseSSO provider={provider} /> : renderForm();
  }
  return (
    renderForm()
  );
};

const mapStateToProps = state => {
  const registerPageState = state.register;
  return {
    backedUpFormData: registerPageState.registrationFormData,
    backendCountryCode: registerPageState.backendCountryCode,
    backendValidations: validationsSelector(state),
    fieldDescriptions: fieldDescriptionSelector(state),
    optionalFields: optionalFieldsSelector(state),
    registrationError: registerPageState.registrationError,
    registrationErrorCode: registrationErrorSelector(state),
    registrationResult: registerPageState.registrationResult,
    shouldBackupState: registerPageState.shouldBackupState,
    userPipelineDataLoaded: registerPageState.userPipelineDataLoaded,
    submitState: registerPageState.submitState,
    thirdPartyAuthApiStatus: state.commonComponents.thirdPartyAuthApiStatus,
    thirdPartyAuthContext: thirdPartyAuthContextSelector(state),
    validationApiRateLimited: registerPageState.validationApiRateLimited,
    usernameSuggestions: registerPageState.usernameSuggestions,
  };
};

RegistrationPage.propTypes = {
  backedUpFormData: PropTypes.shape({
    configurableFormFields: PropTypes.shape({}),
    formFields: PropTypes.shape({}),
    errors: PropTypes.shape({}),
    emailSuggestion: PropTypes.shape({}),
  }),
  backendCountryCode: PropTypes.string,
  backendValidations: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
    username: PropTypes.string,
    password: PropTypes.string,
  }),
  fieldDescriptions: PropTypes.shape({}),
  institutionLogin: PropTypes.bool,
  optionalFields: PropTypes.shape({}),
  registrationError: PropTypes.shape({}),
  registrationErrorCode: PropTypes.string,
  registrationResult: PropTypes.shape({
    redirectUrl: PropTypes.string,
    success: PropTypes.bool,
  }),
  shouldBackupState: PropTypes.bool,
  submitState: PropTypes.string,
  thirdPartyAuthApiStatus: PropTypes.string,
  thirdPartyAuthContext: PropTypes.shape({
    autoSubmitRegForm: PropTypes.bool,
    countryCode: PropTypes.string,
    currentProvider: PropTypes.string,
    errorMessage: PropTypes.string,
    finishAuthUrl: PropTypes.string,
    pipelineUserDetails: PropTypes.shape({
      email: PropTypes.string,
      name: PropTypes.string,
      firstName: PropTypes.string,
      lastName: PropTypes.string,
      username: PropTypes.string,
    }),
    platformName: PropTypes.string,
    providers: PropTypes.arrayOf(
      PropTypes.shape({}),
    ),
    secondaryProviders: PropTypes.arrayOf(
      PropTypes.shape({}),
    ),
  }),
  usernameSuggestions: PropTypes.arrayOf(PropTypes.string),
  userPipelineDataLoaded: PropTypes.bool,
  validationApiRateLimited: PropTypes.bool,
  // Actions
  backupFormState: PropTypes.func.isRequired,
  clearBackendError: PropTypes.func.isRequired,
  getRegistrationDataFromBackend: PropTypes.func.isRequired,
  handleInstitutionLogin: PropTypes.func,
  registerNewUser: PropTypes.func.isRequired,
  resetUsernameSuggestions: PropTypes.func.isRequired,
  setUserPipelineDetailsLoaded: PropTypes.func.isRequired,
  validateFromBackend: PropTypes.func.isRequired,
};

RegistrationPage.defaultProps = {
  backedUpFormData: {
    configurableFormFields: {
      marketingEmailsOptIn: true,
    },
    formFields: {
      name: '', email: '', username: '', password: '',
    },
    errors: {
      name: '', email: '', username: '', password: '',
    },
    emailSuggestion: {
      suggestion: '', type: '',
    },
  },
  backendCountryCode: '',
  backendValidations: null,
  fieldDescriptions: {},
  handleInstitutionLogin: null,
  institutionLogin: false,
  optionalFields: {},
  registrationError: {},
  registrationErrorCode: '',
  registrationResult: null,
  shouldBackupState: false,
  submitState: DEFAULT_STATE,
  thirdPartyAuthApiStatus: PENDING_STATE,
  thirdPartyAuthContext: {
    autoSubmitRegForm: false,
    countryCode: null,
    currentProvider: null,
    errorMessage: null,
    finishAuthUrl: null,
    pipelineUserDetails: null,
    providers: [],
    secondaryProviders: [],
  },
  usernameSuggestions: [],
  userPipelineDataLoaded: false,
  validationApiRateLimited: false,
};

export default connect(
  mapStateToProps,
  {
    backupFormState: backupRegistrationFormBegin,
    clearBackendError: clearRegistertionBackendError,
    getRegistrationDataFromBackend: getThirdPartyAuthContext,
    resetUsernameSuggestions: clearUsernameSuggestions,
    validateFromBackend: fetchRealtimeValidations,
    registerNewUser,
    setUserPipelineDetailsLoaded: setUserPipelineDataLoaded,
  },
)(RegistrationPage);
