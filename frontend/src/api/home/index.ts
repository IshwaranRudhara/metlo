import axios from "axios";
import { SummaryResponse, Alert } from "@common/types";
import { getAPIURL } from "../../constants";

export const getSummary = async (): Promise<SummaryResponse> => {
  try {
    const resp = await axios.get<SummaryResponse>(`${getAPIURL()}/summary`);
    if (resp.status === 200 && resp.data) {
      return resp.data;
    }
    return null;
  } catch (err) {
    console.error(`Error fetching summary stats: ${err}`);
    return null;
  }
};

export const getTopAlerts = async (): Promise<Alert[]> => {
  try {
    const resp = await axios.get<Alert[]>(`${getAPIURL()}/topAlerts`);
    if (resp.status === 200 && resp.data) {
      return resp.data;
    }
    return [];
  } catch (err) {
    console.error(`Error fetching top alerts: ${err}`);
    return [];
  }
}