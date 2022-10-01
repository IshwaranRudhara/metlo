import {
  FindOptionsWhere,
  FindManyOptions,
  In,
  FindOptionsOrder,
  Not,
  QueryRunner,
} from "typeorm"
import jsonMap from "json-source-map"
import yaml from "js-yaml"
import SourceMap from "js-yaml-source-map"
import { AppDataSource } from "data-source"
import { Alert, ApiEndpoint, ApiTrace, DataField, OpenApiSpec } from "models"
import {
  AlertType,
  DataSection,
  SpecExtension,
  Status,
  UpdateAlertType,
} from "@common/enums"
import { DATA_SECTION_TO_LABEL_MAP } from "@common/maps"
import { ALERT_TYPE_TO_RISK_SCORE } from "@common/maps"
import {
  GetAlertParams,
  Alert as AlertResponse,
  UpdateAlertParams,
} from "@common/types"
import Error409Conflict from "errors/error-409-conflict"
import Error500InternalServer from "errors/error-500-internal-server"
import { getPathTokens } from "@common/utils"

export class AlertService {
  static async updateAlert(
    alertId: string,
    updateAlertParams: UpdateAlertParams,
  ): Promise<Alert> {
    const alertRepository = AppDataSource.getRepository(Alert)
    const alert = await alertRepository.findOne({
      where: {
        uuid: alertId,
      },
      relations: {
        apiEndpoint: true,
      },
    })
    switch (updateAlertParams.updateType) {
      case UpdateAlertType.IGNORE:
        if (alert.status === Status.IGNORED) {
          throw new Error409Conflict("Alert is already being ignored.")
        } else if (alert.status === Status.RESOLVED) {
          throw new Error409Conflict("Alert is resolved and cannot be ignored.")
        }
        alert.status = Status.IGNORED
        break
      case UpdateAlertType.UNIGNORE:
        if (alert.status !== Status.IGNORED) {
          throw new Error409Conflict("Alert is currently not ignored.")
        }
        alert.status = Status.OPEN
        break
      case UpdateAlertType.RESOLVE:
        if (alert.status === Status.RESOLVED) {
          throw new Error409Conflict("Alert is already resolved.")
        } else if (alert.status === Status.IGNORED) {
          throw new Error409Conflict("Alert is ignored and cannot be resolved.")
        }
        alert.status = Status.RESOLVED
        alert.resolutionMessage =
          updateAlertParams.resolutionMessage?.trim() || null
        break
      case UpdateAlertType.UNRESOLVE:
        if (alert.status !== Status.RESOLVED) {
          throw new Error409Conflict("Alert is currently not resolved.")
        }
        alert.status = Status.OPEN
        break
      default:
        throw new Error500InternalServer("Unknown update type.")
    }
    await alertRepository.update({ uuid: alertId }, alert)
    return alert
  }

  static async getAlerts(
    alertParams: GetAlertParams,
  ): Promise<[AlertResponse[], number]> {
    const alertRepository = AppDataSource.getRepository(Alert)
    let whereConditions: FindOptionsWhere<Alert>[] | FindOptionsWhere<Alert> =
      {}
    let paginationParams: FindManyOptions<Alert> = {}
    let orderParams: FindOptionsOrder<Alert> = {}

    if (alertParams?.apiEndpointUuid) {
      whereConditions = {
        ...whereConditions,
        apiEndpointUuid: alertParams.apiEndpointUuid,
      }
    }
    if (alertParams?.alertTypes) {
      whereConditions = {
        ...whereConditions,
        type: In(alertParams.alertTypes),
      }
    }
    if (alertParams?.riskScores) {
      whereConditions = {
        ...whereConditions,
        riskScore: In(alertParams.riskScores),
      }
    }
    if (alertParams?.hosts) {
      whereConditions = {
        ...whereConditions,
        apiEndpoint: {
          host: In(alertParams.hosts),
        },
      }
    }
    if (alertParams?.status) {
      whereConditions = {
        ...whereConditions,
        status: In(alertParams.status),
      }
    }
    if (alertParams?.offset) {
      paginationParams = {
        ...paginationParams,
        skip: alertParams.offset,
      }
    }
    if (alertParams?.limit) {
      paginationParams = {
        ...paginationParams,
        take: alertParams.limit,
      }
    }
    if (alertParams?.order) {
      orderParams = {
        riskScore: alertParams.order,
      }
    } else {
      orderParams = {
        riskScore: "DESC",
      }
    }

    const alerts = await alertRepository.findAndCount({
      //@ts-ignore
      select: {
        uuid: true,
        type: true,
        riskScore: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        resolutionMessage: true,
        context: true,
        apiEndpointUuid: true,
        apiEndpoint: {
          method: true,
          uuid: true,
          path: true,
          host: true,
          openapiSpecName: true,
          openapiSpec: {
            minimizedSpecContext: true,
            extension: true,
          },
        },
      },
      where: whereConditions,
      ...paginationParams,
      relations: {
        apiEndpoint: {
          openapiSpec: true,
        },
      },
      order: {
        status: "DESC",
        ...orderParams,
        createdAt: "DESC",
      },
    })

    return alerts
  }

  static async getAlert(alertId: string): Promise<AlertResponse> {
    const alertRepository = AppDataSource.getRepository(Alert)
    return await alertRepository.findOneBy({ uuid: alertId })
  }

  static async getAlertWithConditions(
    conditions: FindOptionsWhere<Alert>,
  ): Promise<Alert> {
    const alertRepository = AppDataSource.getRepository(Alert)
    return await alertRepository.findOneBy(conditions)
  }

  static async existingUnresolvedAlert(
    apiEndpointUuid: string,
    type: AlertType,
    description: string,
  ) {
    const alertRepository = AppDataSource.getRepository(Alert)
    return await alertRepository.findOneBy({
      apiEndpointUuid,
      type,
      status: Not(Status.RESOLVED),
      description,
    })
  }

  static async createAlert(
    alertType: AlertType,
    apiEndpoint: ApiEndpoint,
    description?: string,
    context?: object,
    noDuplicate?: boolean,
  ): Promise<Alert> {
    const alertRepository = AppDataSource.getRepository(Alert)
    let alertDescription = description
    if (!alertDescription) {
      switch (alertType) {
        case AlertType.NEW_ENDPOINT:
          alertDescription = `A new endpoint has been detected: ${apiEndpoint.path}.`
          break
        case AlertType.OPEN_API_SPEC_DIFF:
          alertDescription = `A OpenAPI Spec diff has been detected.`
          break
        case AlertType.PII_DATA_DETECTED:
          alertDescription = `PII Data has been detected.`
          break
        default:
          alertDescription = `A new alert.`
      }
    }
    if (noDuplicate) {
      const existing = await this.existingUnresolvedAlert(
        apiEndpoint.uuid,
        alertType,
        alertDescription,
      )
      if (existing) {
        return null
      }
    }
    const newAlert = new Alert()
    newAlert.type = alertType
    newAlert.riskScore = ALERT_TYPE_TO_RISK_SCORE[alertType]
    newAlert.apiEndpointUuid = apiEndpoint.uuid
    newAlert.context = context
    newAlert.description = alertDescription
    return newAlert
  }

  static existingDataFieldAlert(
    dataFieldAlerts: Alert[],
    apiEndpointUuid: string,
    description: string,
  ): boolean {
    if (!dataFieldAlerts) {
      return false
    }
    for (const alert of dataFieldAlerts) {
      if (
        alert.apiEndpointUuid === apiEndpointUuid &&
        alert.description === description
      ) {
        return true
      }
    }
    return false
  }

  static async createDataFieldAlerts(
    dataFields: DataField[],
    apiEndpointUuid: string,
    apiEndpointPath: string,
    apiTrace: ApiTrace,
    sensitiveDataAlerts?: Alert[],
  ): Promise<Alert[]> {
    try {
      if (!dataFields) {
        return []
      }

      let alerts: Alert[] = sensitiveDataAlerts ?? []
      for (const dataField of dataFields) {
        if (dataField.dataSection === DataSection.REQUEST_HEADER) {
          const requestHeaders = apiTrace?.requestHeaders
          const basicAuthDescription = `Basic Authentication detected in Authorization header.`
          if (requestHeaders) {
            let found = false
            for (let i = 0; i < requestHeaders.length && !found; i++) {
              const header = requestHeaders[i]
              if (
                header.name.toLowerCase() === "authorization" &&
                header.value.toLowerCase().includes("basic ")
              ) {
                found = true
                const existing =
                  this.existingDataFieldAlert(
                    alerts,
                    apiEndpointUuid,
                    basicAuthDescription,
                  ) ||
                  (await this.existingUnresolvedAlert(
                    apiEndpointUuid,
                    AlertType.BASIC_AUTHENTICATION_DETECTED,
                    basicAuthDescription,
                  ))
                if (!existing) {
                  const newAlert = new Alert()
                  newAlert.type = AlertType.BASIC_AUTHENTICATION_DETECTED
                  newAlert.riskScore =
                    ALERT_TYPE_TO_RISK_SCORE[
                      AlertType.BASIC_AUTHENTICATION_DETECTED
                    ]
                  newAlert.apiEndpointUuid = apiEndpointUuid
                  newAlert.context = {
                    trace: apiTrace,
                  }
                  newAlert.description = basicAuthDescription
                  alerts.push(newAlert)
                }
              }
            }
          }
        }

        if (dataField.dataClasses) {
          for (const dataClass of dataField.dataClasses) {
            let alertsToAdd: {
              description: string
              type: AlertType
              context: object
            }[] = []

            const description = `Sensitive data of type ${dataClass} has been detected in field '${
              dataField.dataPath
            }' of ${DATA_SECTION_TO_LABEL_MAP[dataField.dataSection]}.`
            alertsToAdd.push({
              description,
              type: AlertType.PII_DATA_DETECTED,
              context: { trace: apiTrace },
            })

            if (dataField.dataSection === DataSection.REQUEST_QUERY) {
              const sensitiveQueryDescription = `Query Parameter '${dataField.dataPath}' contains sensitive data of type ${dataClass}.`
              alertsToAdd.push({
                description: sensitiveQueryDescription,
                type: AlertType.QUERY_SENSITIVE_DATA,
                context: { trace: apiTrace },
              })
            }
            if (dataField.dataSection === DataSection.REQUEST_PATH) {
              let pathTokenIdx = null
              let sensitivePathDescription = `Path Parameters contain sensitive data of type ${dataClass}.`
              const endpointPathTokens = getPathTokens(apiEndpointPath)
              for (let i = 0; i < endpointPathTokens.length; i++) {
                if (endpointPathTokens[i] === `{${dataField.dataPath}}`) {
                  pathTokenIdx = i
                  sensitivePathDescription = `Path Parameter at position ${
                    i + 1
                  } contains sensitive data of type ${dataClass}.`
                }
              }
              alertsToAdd.push({
                description: sensitivePathDescription,
                type: AlertType.PATH_SENSITIVE_DATA,
                context: { trace: apiTrace, pathTokenIdx },
              })
            }

            for (const alert of alertsToAdd) {
              const existing =
                this.existingDataFieldAlert(
                  alerts,
                  apiEndpointUuid,
                  alert.description,
                ) ||
                (await this.existingUnresolvedAlert(
                  apiEndpointUuid,
                  alert.type,
                  alert.description,
                ))
              if (!existing) {
                const newAlert = new Alert()
                newAlert.type = alert.type
                newAlert.riskScore = ALERT_TYPE_TO_RISK_SCORE[alert.type]
                newAlert.apiEndpointUuid = apiEndpointUuid
                newAlert.context = alert.context
                newAlert.description = alert.description
                alerts.push(newAlert)
              }
            }
          }
        }
      }
      return alerts
    } catch (err) {
      console.error(`Error creating sensitive data alerts: ${err}`)
      return []
    }
  }

  static async createSpecDiffAlerts(
    alertItems: Record<string, string[]>,
    apiEndpointUuid: string,
    apiTrace: ApiTrace,
    openApiSpec: OpenApiSpec,
    queryRunner: QueryRunner,
  ): Promise<Alert[]> {
    try {
      if (!alertItems) {
        return []
      }
      if (Object.keys(alertItems)?.length === 0) {
        return []
      }
      let alerts: Alert[] = []
      for (const key in alertItems) {
        const existing = await this.existingUnresolvedAlert(
          apiEndpointUuid,
          AlertType.OPEN_API_SPEC_DIFF,
          key,
        )
        if (!existing) {
          const newAlert = new Alert()
          newAlert.type = AlertType.OPEN_API_SPEC_DIFF
          newAlert.riskScore =
            ALERT_TYPE_TO_RISK_SCORE[AlertType.OPEN_API_SPEC_DIFF]
          newAlert.apiEndpointUuid = apiEndpointUuid
          const pathPointer = alertItems[key]
          const minimizedSpecKey = pathPointer.join(".")
          newAlert.context = {
            pathPointer,
            trace: apiTrace,
          }
          if (!openApiSpec.minimizedSpecContext[minimizedSpecKey]) {
            let lineNumber = null
            if (openApiSpec.extension === SpecExtension.JSON) {
              const result = jsonMap.parse(openApiSpec.spec)
              let pathKey = ""
              for (let i = 0; i < pathPointer?.length; i++) {
                let pathToken = pathPointer[i]
                pathToken = pathToken.replace(/\//g, "~1")
                pathKey += `/${pathToken}`
              }
              lineNumber = result.pointers?.[pathKey]?.key?.line
              if (lineNumber) {
                lineNumber += 1
              }
            } else if (openApiSpec.extension === SpecExtension.YAML) {
              const map = new SourceMap()
              yaml.load(openApiSpec.spec, { listener: map.listen() })
              lineNumber = map.lookup(pathPointer).line
              if (lineNumber) {
                lineNumber -= 1
              }
            }
            if (lineNumber) {
              const minimizedString = openApiSpec.spec
                .split(/\r?\n/)
                .slice(lineNumber - 5, lineNumber + 5)
                .join("\n")
              openApiSpec.minimizedSpecContext[minimizedSpecKey] = {
                lineNumber,
                minimizedSpec: minimizedString,
              }
            }
          }
          newAlert.description = key
          alerts.push(newAlert)
        }
        await queryRunner.manager
          .createQueryBuilder()
          .update(OpenApiSpec)
          .set({ minimizedSpecContext: openApiSpec.minimizedSpecContext })
          .where("name = :name", { name: openApiSpec.name })
          .execute()
      }
      return alerts
    } catch (err) {
      console.error(`Error creating spec diff alerts: ${err}`)
      return []
    }
  }

  static async createMissingHSTSAlert(
    alertProps: Array<[ApiEndpoint, ApiTrace, string]>,
  ) {
    try {
      if (!alertProps) {
        return []
      }
      let alerts: Alert[] = []
      for (const alertProp of alertProps) {
        const existing = await this.existingUnresolvedAlert(
          alertProp[0].uuid,
          AlertType.UNSECURED_ENDPOINT_DETECTED,
          alertProp[2],
        )
        if (!existing) {
          const newAlert = new Alert()
          newAlert.type = AlertType.UNSECURED_ENDPOINT_DETECTED
          newAlert.riskScore =
            ALERT_TYPE_TO_RISK_SCORE[AlertType.UNSECURED_ENDPOINT_DETECTED]
          newAlert.apiEndpointUuid = alertProp[0].uuid
          newAlert.context = {
            tested_against: `${alertProp[1].host}/${alertProp[1].path}`,
            trace: alertProp[1],
          }
          newAlert.description = alertProp[2]
          alerts.push(newAlert)
        }
      }
      return alerts
    } catch (err) {
      console.error(`Error creating spec diff alerts: ${err}`)
      return []
    }
  }
}
