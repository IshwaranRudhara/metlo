import { GetServerSideProps } from "next"
import ErrorPage from "next/error"
import superjson from "superjson"
import { PageWrapper } from "components/PageWrapper"
import EndpointPage from "components/Endpoint"
import { getEndpoint, getUsage } from "api/endpoints"
import { ApiEndpointDetailed, Usage, Alert, DataClass } from "@common/types"
import { getAlerts } from "api/alerts"
import { Status } from "@common/enums"
import { ALERT_PAGE_LIMIT } from "~/constants"
import { getDataClasses } from "api/dataClasses"
import { GetAlertParams } from "@common/api/alert"

const Endpoint = ({
  endpoint,
  usage,
  alerts,
  dataClasses,
  totalAlertsCount,
  initAlertParams,
}) => {
  const parsedEndpoint = superjson.parse(endpoint) as ApiEndpointDetailed | null
  const parsedUsage = superjson.parse(usage) as Usage[] | []
  const parsedAlerts = superjson.parse(alerts) as Alert[] | []
  const parseDataClasses = superjson.parse(dataClasses) as DataClass[] | []
  if (!parsedEndpoint) {
    return <ErrorPage statusCode={404} />
  }
  return (
    <PageWrapper title="Endpoint">
      <EndpointPage
        endpoint={parsedEndpoint}
        usage={parsedUsage}
        alerts={parsedAlerts}
        dataClasses={parseDataClasses}
        initAlertParams={initAlertParams}
        totalAlertsCount={totalAlertsCount}
      />
    </PageWrapper>
  )
}

export const getServerSideProps: GetServerSideProps = async context => {
  const initAlertParams = {
    uuid: context.query.uuid || null,
    apiEndpointUuid: context.query.endpointUUID || null,
    riskScores: [],
    status: [Status.OPEN],
    alertTypes: [],
    order: "DESC" as const,
    offset: 0,
    limit: ALERT_PAGE_LIMIT,
  } as GetAlertParams
  const endpointPromise = getEndpoint(context.query.endpointUUID as string)
  const usagePromise = getUsage(context.query.endpointUUID as string)
  const alertPromise = getAlerts({ ...initAlertParams })
  const dataClassesPromise = getDataClasses({})
  const promises = [
    endpointPromise,
    usagePromise,
    alertPromise,
    dataClassesPromise,
  ]
  let [endpoint, usage, alerts, dataClasses] = await Promise.all(promises)
  return {
    props: {
      endpoint: superjson.stringify(endpoint),
      usage: superjson.stringify(usage),
      alerts: superjson.stringify(alerts[0]),
      dataClasses: superjson.stringify(dataClasses),
      totalAlertsCount: alerts[1],
      initAlertParams,
    },
  }
}

export default Endpoint
