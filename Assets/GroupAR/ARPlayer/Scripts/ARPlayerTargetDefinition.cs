using System;
using System.Collections.Generic;
using UnityEngine;

namespace GroupAR.ARPlayer
{
    [Serializable]
    public sealed class ARPlayerManifest
    {
        [SerializeField]
        private string schemaVersion = "1.0";

        [SerializeField]
        private int manifestVersion;

        [SerializeField]
        private List<string> deletedTargetIds = new List<string>();

        [SerializeField]
        private List<ARPlayerTargetDefinition> targets = new List<ARPlayerTargetDefinition>();

        [SerializeField]
        private List<ARPlayerContentDefinition> content = new List<ARPlayerContentDefinition>();

        [SerializeField]
        private ARPlayerGroupReference group = new ARPlayerGroupReference();

        public ARPlayerManifest()
        {
        }

        public ARPlayerManifest(
            IReadOnlyList<ARPlayerTargetDefinition> targets,
            IReadOnlyList<ARPlayerContentDefinition> content)
        {
            if (targets != null)
            {
                this.targets.AddRange(targets);
            }

            if (content != null)
            {
                this.content.AddRange(content);
            }
        }

        public ARPlayerManifest(
            int manifestVersion,
            string groupId,
            string groupName,
            IReadOnlyList<ARPlayerTargetDefinition> targets,
            IReadOnlyList<ARPlayerContentDefinition> content)
            : this(targets, content)
        {
            this.manifestVersion = manifestVersion;
            group = new ARPlayerGroupReference(groupId, groupName);
        }

        public string SchemaVersion => schemaVersion;

        public int ManifestVersion => manifestVersion;

        public List<string> DeletedTargetIds => deletedTargetIds;

        public List<ARPlayerTargetDefinition> Targets => targets;

        public List<ARPlayerContentDefinition> Content => content;

        public ARPlayerGroupReference Group => group;

        public bool HasTargets => targets != null && targets.Count > 0;

        public bool HasContent => content != null && content.Count > 0;

        public bool IsTargetDeleted(string targetId)
        {
            return !string.IsNullOrWhiteSpace(targetId) &&
                deletedTargetIds != null &&
                deletedTargetIds.Contains(targetId);
        }
    }

    [Serializable]
    public sealed class ARPlayerGroupReference
    {
        [SerializeField]
        private string id;

        [SerializeField]
        private string name;

        public ARPlayerGroupReference()
        {
        }

        public ARPlayerGroupReference(string id, string name)
        {
            this.id = id;
            this.name = name;
        }

        public string Id => id;

        public string Name => name;
    }

    [Serializable]
    public sealed class ARPlayerTargetDefinition
    {
        [SerializeField]
        private string targetId = "target.test.001";

        [SerializeField]
        private string triggerImageId;

        [SerializeField]
        private float physicalWidthMeters = 0.12f;

        [SerializeField]
        private ARPlayerTargetImageDefinition image = new ARPlayerTargetImageDefinition();

        [SerializeField]
        private List<string> contentIds = new List<string>();

        [SerializeField]
        private string primaryContentId = "content.test.001";

        [SerializeField]
        private Color debugColor = new Color(0.1f, 0.65f, 0.95f, 1f);

        public ARPlayerTargetDefinition()
        {
        }

        public ARPlayerTargetDefinition(
            string targetId,
            string primaryContentId,
            string triggerImageUrl,
            string imageSha256,
            float physicalWidthMeters,
            Color debugColor)
        {
            this.targetId = targetId;
            this.primaryContentId = primaryContentId;
            this.contentIds.Add(primaryContentId);
            this.image = new ARPlayerTargetImageDefinition(triggerImageUrl, imageSha256);
            this.physicalWidthMeters = physicalWidthMeters;
            this.debugColor = debugColor;
        }

        public ARPlayerTargetDefinition(
            string targetId,
            string triggerImageId,
            string primaryContentId,
            string triggerImageUrl,
            string imageSha256,
            string imageContentType,
            int imageWidth,
            int imageHeight,
            long imageByteSize,
            float physicalWidthMeters,
            Color debugColor)
        {
            this.targetId = targetId;
            this.triggerImageId = triggerImageId;
            this.primaryContentId = primaryContentId;
            contentIds.Add(primaryContentId);
            image = new ARPlayerTargetImageDefinition(
                triggerImageUrl,
                imageSha256,
                imageContentType,
                imageWidth,
                imageHeight,
                imageByteSize);
            this.physicalWidthMeters = physicalWidthMeters;
            this.debugColor = debugColor;
        }

        public string TargetId => targetId;

        public string TriggerImageId => triggerImageId;

        public float PhysicalWidthMeters => physicalWidthMeters;

        public ARPlayerTargetImageDefinition Image => image;

        public IReadOnlyList<string> ContentIds => contentIds != null
            ? contentIds
            : Array.Empty<string>();

        public string PrimaryContentId => primaryContentId;

        public Color DebugColor => debugColor;

        public bool HasTriggerImageUrl => image != null && image.HasUrl;

        public bool TryValidate(out string message, bool allowGeneratedImage = false)
        {
            if (string.IsNullOrWhiteSpace(targetId))
            {
                message = "Target ID is required.";
                return false;
            }

            if (physicalWidthMeters <= 0f)
            {
                message = $"Physical width must be greater than zero for target '{targetId}'.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(primaryContentId))
            {
                message = $"Primary content ID is required for target '{targetId}'.";
                return false;
            }

            if (contentIds == null || contentIds.Count == 0)
            {
                message = $"At least one content ID is required for target '{targetId}'.";
                return false;
            }

            if (!contentIds.Contains(primaryContentId))
            {
                message = $"Primary content ID '{primaryContentId}' must be present in contentIds[] for target '{targetId}'.";
                return false;
            }

            if (image == null)
            {
                message = $"Image metadata is required for target '{targetId}'.";
                return false;
            }

            if (!image.TryValidate(targetId, allowGeneratedImage, out message))
            {
                return false;
            }

            message = string.Empty;
            return true;
        }
    }

    [Serializable]
    public sealed class ARPlayerTargetImageDefinition
    {
        [SerializeField]
        private string url;

        [SerializeField]
        private string contentType;

        [SerializeField]
        private int width;

        [SerializeField]
        private int height;

        [SerializeField]
        private long byteSize;

        [SerializeField]
        private string sha256;

        public ARPlayerTargetImageDefinition()
        {
        }

        public ARPlayerTargetImageDefinition(string url, string sha256)
        {
            this.url = url;
            this.sha256 = sha256;
        }

        public ARPlayerTargetImageDefinition(
            string url,
            string sha256,
            string contentType,
            int width,
            int height,
            long byteSize)
        {
            this.url = url;
            this.sha256 = sha256;
            this.contentType = contentType;
            this.width = width;
            this.height = height;
            this.byteSize = byteSize;
        }

        public string Url => url;

        public string ContentType => contentType;

        public int Width => width;

        public int Height => height;

        public long ByteSize => byteSize;

        public string Sha256 => sha256;

        public bool HasUrl => !string.IsNullOrWhiteSpace(url);

        public bool HasSha256 => !string.IsNullOrWhiteSpace(sha256);

        public bool TryValidate(string targetId, bool allowGeneratedImage, out string message)
        {
            if (!HasUrl && !allowGeneratedImage)
            {
                message = $"Image URL is required for target '{targetId}'.";
                return false;
            }

            if (!HasSha256 && !allowGeneratedImage)
            {
                message = $"Image sha256 is required for target '{targetId}'.";
                return false;
            }

            message = string.Empty;
            return true;
        }
    }

    [Serializable]
    public sealed class ARPlayerContentDefinition
    {
        [SerializeField]
        private string contentId = "content.test.001";

        [SerializeField]
        private string type = "image";

        [SerializeField]
        private string role = "primary";

        [SerializeField]
        private string url;

        [SerializeField]
        private string contentType;

        [SerializeField]
        private long byteSize;

        [SerializeField]
        private string sha256;

        [SerializeField]
        private ARPlayerContentMetadata metadata = new ARPlayerContentMetadata();

        [SerializeField]
        private Color debugColor = new Color(0.1f, 0.65f, 0.95f, 1f);

        public ARPlayerContentDefinition()
        {
        }

        public ARPlayerContentDefinition(
            string contentId,
            string type,
            string role,
            string url,
            string contentType,
            long byteSize,
            string sha256,
            ARPlayerContentMetadata metadata,
            Color debugColor)
        {
            this.contentId = contentId;
            this.type = type;
            this.role = role;
            this.url = url;
            this.contentType = contentType;
            this.byteSize = byteSize;
            this.sha256 = sha256;
            this.metadata = metadata ?? new ARPlayerContentMetadata();
            this.debugColor = debugColor;
        }

        public string ContentId => contentId;

        public string Type => type;

        public string Role => role;

        public string Url => url;

        public string ContentType => contentType;

        public long ByteSize => byteSize;

        public string Sha256 => sha256;

        public ARPlayerContentMetadata Metadata => metadata;

        public Color DebugColor => debugColor;

        public bool IsPrimary => string.Equals(role, "primary", StringComparison.OrdinalIgnoreCase);

        public bool HasUrl => !string.IsNullOrWhiteSpace(url);

        public bool TryValidate(out string message)
        {
            if (string.IsNullOrWhiteSpace(contentId))
            {
                message = "Content ID is required.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(type))
            {
                message = $"Content type is required for content '{contentId}'.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(role))
            {
                message = $"Content role is required for content '{contentId}'.";
                return false;
            }

            message = string.Empty;
            return true;
        }
    }

    [Serializable]
    public sealed class ARPlayerContentMetadata
    {
        [SerializeField]
        private string placement = "onImage";

        [SerializeField]
        private float scale = 1f;

        [SerializeField]
        private bool loop = true;

        public string Placement => placement;

        public float Scale => scale;

        public bool Loop => loop;
    }

    public readonly struct ARPlayerLoadProgress
    {
        public ARPlayerLoadProgress(
            int completedTargets,
            int totalTargets,
            string targetId,
            string message)
        {
            CompletedTargets = completedTargets;
            TotalTargets = totalTargets;
            TargetId = targetId;
            Message = message;
        }

        public int CompletedTargets { get; }

        public int TotalTargets { get; }

        public string TargetId { get; }

        public string Message { get; }

        public float Normalized => TotalTargets <= 0 ? 0f : Mathf.Clamp01((float) CompletedTargets / TotalTargets);
    }
}
