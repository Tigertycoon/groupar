using System;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace GroupAR.ARPlayer
{
    public readonly struct ARPlayerContentRenderContext
    {
        public ARPlayerContentRenderContext(
            ARTrackedImage trackedImage,
            ARPlayerTargetDefinition target,
            ARPlayerContentDefinition content,
            Vector3 localScale)
        {
            TrackedImage = trackedImage;
            Target = target;
            Content = content;
            LocalScale = localScale;
        }

        public ARTrackedImage TrackedImage { get; }

        public ARPlayerTargetDefinition Target { get; }

        public ARPlayerContentDefinition Content { get; }

        public Vector3 LocalScale { get; }
    }

    public interface IARPlayerContentRenderer
    {
        bool CanRender(ARPlayerContentDefinition content);

        GameObject Render(ARPlayerContentRenderContext context, GameObject existingContent);

        void Release(GameObject content);
    }

    public abstract class ARPlayerContentRendererBase : MonoBehaviour, IARPlayerContentRenderer
    {
        protected abstract string SupportedType { get; }

        protected virtual Color PlaceholderColor => new Color(0.1f, 0.65f, 0.95f, 1f);

        public virtual bool CanRender(ARPlayerContentDefinition content)
        {
            return content != null &&
                string.Equals(content.Type, SupportedType, StringComparison.OrdinalIgnoreCase);
        }

        public virtual GameObject Render(ARPlayerContentRenderContext context, GameObject existingContent)
        {
            GameObject content = existingContent != null
                ? existingContent
                : CreateDebugCube();

            content.name = BuildObjectName(context.Content);
            ApplyDebugMaterial(content, ResolveColor(context));
            content.transform.localScale = context.LocalScale;
            return content;
        }

        public virtual void Release(GameObject content)
        {
            if (content != null)
            {
                Destroy(content);
            }
        }

        protected virtual Color ResolveColor(ARPlayerContentRenderContext context)
        {
            return context.Content != null && context.Content.DebugColor.a > 0f
                ? context.Content.DebugColor
                : PlaceholderColor;
        }

        protected virtual string BuildObjectName(ARPlayerContentDefinition content)
        {
            string contentId = content != null ? content.ContentId : "unknown";
            return $"AR {SupportedType} Stub - {contentId}";
        }

        private static GameObject CreateDebugCube()
        {
            GameObject content = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Collider collider = content.GetComponent<Collider>();
            if (collider != null)
            {
                Destroy(collider);
            }

            return content;
        }

        private static void ApplyDebugMaterial(GameObject content, Color color)
        {
            MeshRenderer renderer = content.GetComponent<MeshRenderer>();
            if (renderer == null)
            {
                return;
            }

            Material material = renderer.sharedMaterial;
            if (material == null || !material.name.StartsWith("GroupAR Runtime", StringComparison.Ordinal))
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null)
                {
                    shader = Shader.Find("Standard");
                }

                material = new Material(shader)
                {
                    name = "GroupAR Runtime Content Material"
                };
            }

            material.color = color;
            renderer.sharedMaterial = material;
        }
    }

    public sealed class ARPlayerImageContentRenderer : ARPlayerContentRendererBase
    {
        protected override string SupportedType => "image";

        protected override Color PlaceholderColor => new Color(0.12f, 0.7f, 0.46f, 1f);
    }

    public sealed class ARPlayerVideoContentRenderer : ARPlayerContentRendererBase
    {
        protected override string SupportedType => "video";

        protected override Color PlaceholderColor => new Color(0.9f, 0.35f, 0.12f, 1f);
    }

    public sealed class ARPlayerModel3DContentRenderer : ARPlayerContentRendererBase
    {
        protected override string SupportedType => "model3d";

        protected override Color PlaceholderColor => new Color(0.35f, 0.48f, 0.95f, 1f);
    }

    public sealed class ARPlayerDebugContentRenderer : ARPlayerContentRendererBase
    {
        protected override string SupportedType => "debug";

        public override bool CanRender(ARPlayerContentDefinition content)
        {
            return content != null;
        }
    }
}
