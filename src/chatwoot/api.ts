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
    // Try to find existing conversation for this contact + inbox to avoid duplicates
    const contactIdNum = parseInt(data.contact_id);
    const inboxIdNum = parseInt(data.inbox_id);
    
    try {
      console.log(`[Chatwoot Debug] Looking for existing conversation: contact_id=${contactIdNum}, inbox_id=${inboxIdNum}`);
      
      // Try listing conversations for the inbox
      const existingList = await this.request(
        `/api/v1/accounts/${this.config.accountId}/conversations?inbox_id=${inboxIdNum}`
      );
      
      console.log(`[Chatwoot Debug] Raw response from /conversations:`, JSON.stringify(existingList).substring(0, 500));
      
      // Parse the response and filter locally
      let conversations: any[] = [];
      if (Array.isArray(existingList)) {
        conversations = existingList;
      } else if (Array.isArray(existingList?.data?.payload)) {
        conversations = existingList.data.payload;
      } else if (existingList?.conversations) {
        conversations = existingList.conversations;
      } else if (Array.isArray(existingList?.data)) {
        conversations = existingList.data;
      } else if (Array.isArray(existingList?.payload)) {
        conversations = existingList.payload;
      }
      
      console.log(`[Chatwoot Debug] Parsed ${conversations.length} conversations from response`);
      
      // Filter locally to find matching contact
      const existing = conversations.find((conv: any) => {
        const convContactId = conv.contact_id || conv.contact?.id || conv.meta?.sender?.id;
        console.log(`[Chatwoot Debug] Conv object keys:`, Object.keys(conv).slice(0, 10));
        console.log(`[Chatwoot Debug] Checking conversation ${conv.id}: contact_id=${convContactId} (from contact_id=${conv.contact_id}, contact.id=${conv.contact?.id}, meta.sender.id=${conv.meta?.sender?.id}) vs searching=${contactIdNum}`);
        const isMatch = convContactId === contactIdNum;
        if (isMatch) {
          console.log(`[Chatwoot Debug] ✅ FOUND MATCH: conversation ${conv.id} for contact ${contactIdNum}`);
        }
        return isMatch;
      });
      
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
        try {
          // List all conversations (without inbox filter) to find the one with this source_id
          const allConversations = await this.request(
            `/api/v1/accounts/${this.config.accountId}/conversations`
          );
          let convList: any[] = [];
          if (Array.isArray(allConversations?.data?.payload)) {
            convList = allConversations.data.payload;
          } else if (Array.isArray(allConversations?.payload)) {
            convList = allConversations.payload;
          }

          const existing = convList.find((c: any) => {
            const cid = c.source_id || c.contact_inbox?.source_id || c.additional_attributes?.source_id;
            return cid === data.source_id;
          });
          if (existing) {
            console.log(`[Chatwoot Debug] Found existing conversation by source_id (checked multiple fields):`, existing.id);
            return existing;
          }
          console.log(`[Chatwoot Debug] No conversation found with source_id=${data.source_id}, searched ${convList.length} conversations`);
        } catch (searchErr) {
          console.log(`[Chatwoot Debug] Failed to search for existing conversation:`, searchErr);
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
