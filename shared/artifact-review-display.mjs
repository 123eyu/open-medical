// Reviewing increments the artifact version after recording the reviewed content version.
export function hasCurrentArtifactReview(artifact) {
  const review = artifact?.review;
  return ['approved', 'rejected'].includes(artifact?.status)
    && review?.decision === artifact.status
    && Number.isInteger(review.reviewedVersion)
    && artifact.version === review.reviewedVersion + 1;
}
