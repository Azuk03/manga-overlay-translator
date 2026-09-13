// Bo dem chuyen giao giua A-worker (GPU) va B-worker (mang).
//
// Chan tren nho (2) la CO Y: ket qua pha A mang theo anh nen cua tung vung,
// do duoc vai MB moi trang. Khong chan thi A chay xa tuy y va om het trong
// bo nho. Hai la du de B luon co viec trong luc A lam trang ke tiep.

function motCreateHandoff(limit) {
  // Validate limit: must be a positive integer. Silently unbounded buffer would
  // defeat the only reason this module exists (bounding memory accumulation).
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('limit phai la duong so nguyen');
  }

  const items = [];
  let closed = false;
  let spaceWaiters = [];
  let itemWaiters = [];

  // release() wakes all queued waiters. This is safe because of single-producer/
  // single-consumer usage: neither waiter list can hold more than one callback.
  // Adding a second producer or consumer would require revisiting this (one
  // waiter per producer/consumer, or a condition variable).
  const release = (list) => { const w = list.splice(0); w.forEach((fn) => fn()); };

  return {
    size: () => items.length,
    isFull: () => items.length >= limit,
    isClosed: () => closed,
    push(item) {
      // Shutdown is not a programmer error - just a no-op.
      if (closed) return false;
      // Full buffer while still open is a caller bug - they forgot to await waitForSpace().
      if (items.length >= limit) throw new Error('handoff day - phai await waitForSpace() truoc');
      items.push(item);
      release(itemWaiters);
      return true;
    },
    take() {
      if (!items.length) return null;
      const item = items.shift();
      release(spaceWaiters);
      return item;
    },
    waitForSpace() {
      if (closed || items.length < limit) return Promise.resolve();
      return new Promise((res) => spaceWaiters.push(res));
    },
    waitForItem() {
      if (closed || items.length > 0) return Promise.resolve();
      return new Promise((res) => itemWaiters.push(res));
    },
    // Go moi ben dang cho. Khong co buoc nay thi khi dung giua chung (doi
    // trang, huy hang doi) worker se treo mai o await.
    close() {
      closed = true;
      release(spaceWaiters);
      release(itemWaiters);
    },
  };
}
