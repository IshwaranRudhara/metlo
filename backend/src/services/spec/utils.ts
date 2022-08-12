import { OpenAPIRequestValidatorError } from "openapi-request-validator";
import { OpenAPIResponseValidatorError } from "openapi-response-validator";

export const generateAlertMessageFromReqErrors = (
  errors: OpenAPIRequestValidatorError[]
): string[] => {
  return (
    errors?.map((error) => {
      switch (error.errorCode.split(".")[0]) {
        case "required":
          return `Required property '${error.path}' is missing from request ${error.location}`;
        case "type":
          return `Property '${error.path}' ${error.message} in request ${error.location}`;
        case "additionalProperties":
          return `Property '${error.path}' is present in request ${error.location} without being defined in OpenAPI Spec`;
        default:
          return `${error.message}: '${error.path}' in request ${error.location}`;
      }
    }) || []
  );
};

export const generateAlertMessageFromRespErrors = (
  errors: OpenAPIResponseValidatorError[]
): string[] => {
  return (
    errors?.map((error) => {
      switch (error.errorCode.split(".")[0]) {
        case "required":
          return `Required property '${error.path}' is missing from response body`;
        case "type":
          return `Property '${error.path}' ${error.message} in response body`;
        case "additionalProperties":
          return `Property '${error.path}' is present in response body without being defined in OpenAPI Spec`;
        default:
          return `${error.message}: '${error.path}' in response body`;
      }
    }) || []
  );
};