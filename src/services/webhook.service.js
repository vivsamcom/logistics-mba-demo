function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findContact(contacts, message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  return (
    contacts.find((contact) => contact && contact.wa_id === message.from) ||
    contacts[0] ||
    null
  );
}

function extractWhatsAppEvents(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const events = [];

  for (const entry of asArray(payload.entry)) {
    for (const change of asArray(entry && entry.changes)) {
      const value = change && change.value;

      if (!value || typeof value !== 'object') {
        continue;
      }

      const metadata = value.metadata || {};
      const contacts = asArray(value.contacts);

      for (const message of asArray(value.messages)) {
        if (!message || typeof message !== 'object') {
          continue;
        }

        events.push({
          type: 'MESSAGE',
          phoneNumberId: metadata.phone_number_id || null,
          displayPhoneNumber: metadata.display_phone_number || null,
          contact: findContact(contacts, message),
          message
        });
      }

      for (const status of asArray(value.statuses)) {
        if (!status || typeof status !== 'object') {
          continue;
        }

        events.push({
          type: 'STATUS',
          phoneNumberId: metadata.phone_number_id || null,
          status
        });
      }
    }
  }

  return events;
}

function processWhatsAppEvents(events) {
  for (const event of asArray(events)) {
    if (event.type === 'MESSAGE') {
      console.log('WhatsApp MESSAGE received', {
        messageId: event.message && event.message.id,
        messageType: event.message && event.message.type
      });
    } else if (event.type === 'STATUS') {
      console.log('WhatsApp STATUS received', {
        messageId: event.status && event.status.id,
        status: event.status && event.status.status
      });
    }
  }
}

module.exports = {
  extractWhatsAppEvents,
  processWhatsAppEvents
};
