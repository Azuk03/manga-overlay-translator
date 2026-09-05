// Bo dem chuyen giao giua A-worker (GPU) va B-worker (mang).
//
// Chan tren nho (2) la CO Y: ket qua pha A mang theo anh nen cua tung vung,
// do duoc vai MB moi trang. Khong chan thi A chay xa tuy y va om het trong
// bo nho. Hai la du de B luon co viec trong luc A lam trang ke tiep.

function motCreateHandoff(limit) {
  const items = [];
  let closed = false;
  let spaceWaiters = [];
  let itemWaiters = [];

  const release = (list) => { const w = list.splice(0); w.forEach((fn) => fn()); };

  return {
    size: () => items.length,
    isFull: () => items.length >= limit,
    push(item) {
      if (items.length >= limit) throw new Error('handoff day - phai await waitForSpace() truoc');
      items.push(item);
      release(itemWaiters);
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
