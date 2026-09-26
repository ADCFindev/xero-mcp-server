import { z } from "zod";
import { getXeroContact } from "../../handlers/xero-single-read-api.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetContactTool = CreateXeroTool(
  "get-contact",
  "Get one Xero contact by ContactID with full contact details.",
  { contactId: z.string().describe("The Xero Contact ID.") },
  async ({ contactId }) => {
    const response = await getXeroContact(contactId);
    if (response.isError) {
      return { content: [{ type: "text" as const, text: `Error getting contact: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetContactTool;
