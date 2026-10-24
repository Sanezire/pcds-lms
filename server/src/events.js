import { EventEmitter } from 'node:events';

// In-process event bus. Routes call publish(topic) after data changes, and
// every open /api/events stream forwards the topic to its browser.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export const TOPICS = { USERS: 'users', ATTENDANCE: 'attendance' };

export function publish(topic) {
  bus.emit('event', topic);
}

export function subscribe(listener) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
