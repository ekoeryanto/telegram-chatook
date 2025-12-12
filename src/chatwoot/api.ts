export interface ChatwootConfig {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  timeout?: number;
}

export class ChatwootAPI {
  private config: ChatwootConfig;

  constructor(config: ChatwootConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 10000,
    };
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.config.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          api_access_token: this.config.apiKey,
          ...options.headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.error("[Chatwoot Debug] Failed to parse response", { text });
      }

      if (!response.ok) {
        console.error("[Chatwoot Debug] Error response", {
          status: response.status,
          statusText: response.statusText,
          data,
        });
        const error = new Error(`Chatwoot API error: ${response.status} ${response.statusText}`) as any;
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async pingChatwoot(): Promise<any> {
    return this.request(`/api/v1/accounts/${this.config.accountId}/inboxes`);
  }

  async getInbox(inboxId: string): Promise<any> {
    return this.request(`/api/v1/accounts/${this.config.accountId}/inboxes/${inboxId}`);
  }

  async getConversation(conversationId: string): Promise<any> {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${conversationId}`);
  }

  async updateContact(contactId: string | number, data: { name?: string; phone_number?: string }): Promise<any> {
    const body: any = {};
    if (typeof data.name === "string" && data.name.trim().length > 0) body.name = data.name.trim();
    if (typeof data.phone_number === "string" && data.phone_number.trim().length > 0)
      body.phone_number = data.phone_number.trim();

    if (Object.keys(body).length === 0) {
      return { ok: true }; // nothing to update
    }

    const response = await this.request(
      `/api/v1/accounts/${this.config.accountId}/contacts/${parseInt(String(contactId))}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    );

    // common response shapes
    if (response.contact) return response.contact;
    if (response.payload?.contact) return response.payload.contact;
    return response;
  }

  async createContact(data: { name?: string; phone_number?: string; identifier?: string }): Promise<any> {
    const body = {
      name: data.name || data.identifier,
      phone_number: data.phone_number,
      identifier: data.identifier,
    };

    try {
      const response = await this.request(`/api/v1/accounts/${this.config.accountId}/contacts`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      // v4.8.0 responses often contain "payload" or direct contact
      if (response.contact) return response.contact;
      if (response.payload?.contact) return response.payload.contact;
      if (response.payload) return response.payload; // some endpoints wrap directly
      if (response.id) return response;

      console.error("[Chatwoot Debug] Unexpected contact response", response);
      throw new Error("Unexpected contact response");
    } catch (error: any) {
      // 409 conflict or 422 duplicate -> search by identifier
      if (error.message?.includes("409") || error.message?.includes("422")) {
        const q = encodeURIComponent(data.identifier || "");

        // Try search endpoint
        try {
          const search = await this.request(
            `/api/v1/accounts/${this.config.accountId}/contacts/search?q=${q}`
          );
          const found = search?.payload?.[0] || search?.contacts?.[0];
          if (found) return found;
        } catch {
          // ignore
        }

        // Try direct list by identifier (some deployments support this)
        try {
          const byIdentifier = await this.request(
            `/api/v1/accounts/${this.config.accountId}/contacts?identifier=${q}`
          );
          const found = byIdentifier?.payload?.[0] || byIdentifier?.contacts?.[0] || byIdentifier?.data?.[0];
          if (found) return found;
        } catch {
          // ignore
        }
      }
      throw error;
    }
  }

  async createConversation(data: { contact_id: string; inbox_id: string; source_id?: string }): Promise<any> {
    const contactIdNum = parseInt(data.contact_id);
    const inboxIdNum = parseInt(data.inbox_id);

    const parseConversations = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw?.data?.payload)) return raw.data.payload;
      if (Array.isArray(raw?.payload)) return raw.payload;
      if (Array.isArray(raw?.data)) return raw.data;
      if (Array.isArray(raw?.conversations)) return raw.conversations;
      if (Array.isArray(raw?.meta?.payload)) return raw.meta.payload;
      return [];
    };

    const matchesContact = (conv: any): boolean => {
      const convContactId = conv.contact_id || conv.contact?.id || conv.meta?.sender?.id;
      const isMatch = convContactId === contactIdNum;
      if (isMatch) {
        console.log(
          `[Chatwoot Debug] ✅ FOUND MATCH: conversation ${conv.id} for contact ${contactIdNum} (contact_id=${conv.contact_id}, contact.id=${conv.contact?.id}, meta.sender.id=${conv.meta?.sender?.id})`
        );
      }
      return isMatch;
    };

    const findExistingByContact = async (): Promise<any | undefined> => {
      // Pagination to cover closed conversations; stop after 5 pages or when empty page is returned
      for (let page = 1; page <= 5; page++) {
        const endpoint = `/api/v1/accounts/${this.config.accountId}/conversations?inbox_id=${inboxIdNum}&status=all&page=${page}`;
        console.log(`[Chatwoot Debug] Fetching conversations page=${page} for inbox_id=${inboxIdNum}`);
        const list = await this.request(endpoint);
        const conversations = parseConversations(list);
        console.log(`[Chatwoot Debug] Page=${page} parsed ${conversations.length} conversations`);

        const existing = conversations.find(matchesContact);
        if (existing) return existing;
        if (!conversations.length) break;
      }
      return undefined;
    };

    try {
      console.log(
        `[Chatwoot Debug] Looking for existing conversation: contact_id=${contactIdNum}, inbox_id=${inboxIdNum}`
      );
      const existing = await findExistingByContact();
      if (existing) {
        console.log(`[Chatwoot Debug] Returning existing conversation: ${existing.id}`);
        return existing;
      }
      console.log(`[Chatwoot Debug] No existing conversation found, will create new one`);
    } catch (e: any) {
      console.log(`[Chatwoot Debug] Error listing conversations:`, e.message);
      // ignore listing errors, fall back to create
    }

    const body = {
      contact_id: contactIdNum,
      inbox_id: inboxIdNum,
      source_id: data.source_id,
      additional_attributes: {
        source_id: data.source_id,
      },
    };

    console.log(`[Chatwoot Debug] Creating new conversation with body:`, body);
    
    try {
      const response = await this.request(`/api/v1/accounts/${this.config.accountId}/conversations`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (response.conversation) {
        console.log(`[Chatwoot Debug] Created conversation:`, response.conversation.id);
        return response.conversation;
      }
      if (response.payload?.conversation) {
        console.log(`[Chatwoot Debug] Created conversation:`, response.payload.conversation.id);
        return response.payload.conversation;
      }
      if (response.id) {
        console.log(`[Chatwoot Debug] Created conversation:`, response.id);
        return response;
      }

      console.error("[Chatwoot Debug] Unexpected conversation response", response);
      throw new Error("Unexpected conversation response");
    } catch (createErr: any) {
      // If source_id already exists, search for the existing conversation
      const errorData = createErr?.data;
      const isSourceIdError = errorData?.error?.includes("source_id") || errorData?.message?.includes("source_id");
      
      if (createErr.status === 422 && isSourceIdError) {
        console.log(`[Chatwoot Debug] source_id conflict detected, searching for existing conversation by source_id`);
        const matchesSourceId = (conv: any): boolean => {
          const cid =
            conv.source_id ||
            conv.contact_inbox?.source_id ||
            conv.additional_attributes?.source_id ||
            conv.meta?.sender?.additional_attributes?.source_id;
          const isMatch = cid === data.source_id;
          if (isMatch) {
            console.log(`[Chatwoot Debug] ✅ FOUND MATCH by source_id in conversation ${conv.id}`);
          }
          return isMatch;
        };

        try {
          // Paginate through conversations to find the matching source_id (include closed conversations)
          for (let page = 1; page <= 5; page++) {
            const endpoint = `/api/v1/accounts/${this.config.accountId}/conversations?status=all&page=${page}`;
            const list = await this.request(endpoint);
            const convList = parseConversations(list);
            console.log(
              `[Chatwoot Debug] Source search page=${page} parsed ${convList.length} conversations (looking for ${data.source_id})`
            );

            const existing = convList.find(matchesSourceId);
            if (existing) return existing;
            if (!convList.length) break;
          }

          // Deep scan: fetch individual conversation details to inspect hidden fields
          console.log(`[Chatwoot Debug] Starting deep scan of conversation details for source_id lookup`);
          for (let page = 1; page <= 5; page++) {
            const endpoint = `/api/v1/accounts/${this.config.accountId}/conversations?status=all&page=${page}`;
            const list = await this.request(endpoint);
            const convList = parseConversations(list);
            for (const c of convList) {
              try {
                const detail = await this.getConversation(String(c.id));
                const cid =
                  detail?.source_id ||
                  detail?.additional_attributes?.source_id ||
                  detail?.contact_inbox?.source_id ||
                  detail?.meta?.sender?.additional_attributes?.source_id;
                if (cid === data.source_id) {
                  console.log(`[Chatwoot Debug] ✅ FOUND MATCH in details: conversation ${detail.id}`);
                  return detail;
                }
              } catch (dErr: any) {
                console.log(`[Chatwoot Debug] Detail fetch failed for conv ${c.id}:`, dErr?.message || dErr);
              }
            }
            if (!convList.length) break;
          }

          // Fallback: try conversations filtered by contact to reduce page scanning
          try {
            const byContact = await this.request(
              `/api/v1/accounts/${this.config.accountId}/conversations?contact_id=${contactIdNum}&status=all`
            );
            const convList = parseConversations(byContact);
            console.log(
              `[Chatwoot Debug] Source search via contact_id parsed ${convList.length} conversations for contact ${contactIdNum}`
            );
            // First try lightweight check
            const existing = convList.find(matchesSourceId);
            if (existing) return existing;
            // Then deep check details for this contact's conversations
            for (const c of convList) {
              try {
                const detail = await this.getConversation(String(c.id));
                const cid =
                  detail?.source_id ||
                  detail?.additional_attributes?.source_id ||
                  detail?.contact_inbox?.source_id ||
                  detail?.meta?.sender?.additional_attributes?.source_id;
                if (cid === data.source_id) {
                  console.log(`[Chatwoot Debug] ✅ FOUND MATCH in contact details: conversation ${detail.id}`);
                  return detail;
                }
              } catch (dErr: any) {
                console.log(`[Chatwoot Debug] Detail fetch (by contact) failed for conv ${c.id}:`, dErr?.message || dErr);
              }
            }
          } catch (contactSearchErr) {
            console.log(`[Chatwoot Debug] Contact_id search failed:`, contactSearchErr);
          }

          console.log(
            `[Chatwoot Debug] No conversation found with source_id=${data.source_id} after paginated search and contact filter`
          );
        } catch (searchErr) {
          console.log(`[Chatwoot Debug] Failed to search for existing conversation:`, searchErr);
        }

        // Last resort: attempt to create conversation without source_id to avoid hard failure
        try {
          console.warn(
            `[Chatwoot Debug] WARN: Could not locate existing conversation by source_id. Retrying creation without source_id to proceed.`
          );
          const fallbackBody = {
            contact_id: contactIdNum,
            inbox_id: inboxIdNum,
            // source_id intentionally omitted
            additional_attributes: {
              source_id: data.source_id,
            },
          } as any;
          const resp = await this.request(`/api/v1/accounts/${this.config.accountId}/conversations`, {
            method: "POST",
            body: JSON.stringify(fallbackBody),
          });
          const conv = resp.conversation || resp.payload?.conversation || resp;
          if (conv?.id) {
            console.log(`[Chatwoot Debug] Created conversation without source_id as fallback: ${conv.id}`);
            return conv;
          }
        } catch (fallbackErr: any) {
          console.log(`[Chatwoot Debug] Fallback creation without source_id failed:`, fallbackErr?.message || fallbackErr);
        }
      }
      throw createErr;
    }
  }

  async createMessage(conversationId: string, data: { content: string; message_type?: string; private?: boolean }): Promise<any> {
    const body = {
      content: data.content,
      message_type: data.message_type || "incoming",
      private: data.private || false,
    };

    const response = await this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (response.message) return response.message;
    if (response.payload?.message) return response.payload.message;
    return response;
  }
}

export function createChatwootAPI(): ChatwootAPI {
  const baseUrl = process.env.CHATWOOT_URL;
  const apiKey = process.env.CHATWOOT_API_KEY;
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || "1";

  if (!baseUrl || !apiKey) {
    throw new Error("CHATWOOT_URL and CHATWOOT_API_KEY must be set");
  }

  return new ChatwootAPI({ baseUrl, apiKey, accountId });
}
