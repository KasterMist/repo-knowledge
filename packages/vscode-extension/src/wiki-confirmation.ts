import type { WikiReview } from '@repo-knowledge/core';
export class WikiConfirmation {
  private review: WikiReview | undefined;
  private closed = false;
  stage(review?: WikiReview) {
    this.review = review;
  }
  dispose() {
    this.closed = true;
    this.review = undefined;
  }
  async confirm(
    ask: (review: WikiReview) => Promise<boolean>,
    ready: () => void,
    commit: (review: WikiReview) => Promise<unknown>,
  ) {
    const review = this.review;
    if (!review || this.closed)
      throw new Error('Review a target before confirmation.');
    ready();
    if (!(await ask(review))) return { cancelled: true };
    if (this.closed || this.review !== review)
      throw new Error('Review context changed.');
    ready();
    try {
      return await commit(review);
    } finally {
      this.review = undefined;
    }
  }
}
