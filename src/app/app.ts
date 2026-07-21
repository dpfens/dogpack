import { Component, inject, signal } from '@angular/core';

import { WorkbenchComponent } from './components/ui/workbench/workbench';
import { SourceImageService } from './services/source-image/source-image-service';

@Component({
  selector: 'app-root',
  imports: [WorkbenchComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  private readonly sourceImageService = inject(SourceImageService);

  /** null = show the landing/ornamentation; set = show the workbench. */
  readonly sourceImage = this.sourceImageService.image;
  readonly error = this.sourceImageService.error;

  /** Purely local UI state for the dropzone hover style - doesn't belong in the service. */
  readonly isDragging = signal(false);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.sourceImageService.loadFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.sourceImageService.loadFile(file);
    // Allow re-selecting the same file later.
    input.value = '';
  }

  /** Drop back to the landing screen and pick a different image. */
  reset(): void {
    this.sourceImageService.reset();
  }

  readonly faqs = [
    {
      "name": "Choosing an algorithm",
      "items": [
        {
          "question": "What's the difference between XDoG, FDoG, ADoG, and HDoG?",
          "answer": "XDoG finds edges by subtracting two Gaussian blurs and thresholding the result.  It's fast, but only renders lines. FDoG does the same thing, but first computes an \"edge tangent flow\" (the dominant direction of nearby edges) and blurs along that flow instead of uniformly, so lines stay smooth and connected instead of fragmenting in textured/noisy areas. ADoG uses the same Gaussian-subtraction idea but makes its sensitivity to contrast vary with local brightness, so it produces denser dot-like clusters in dark areas and sparser ones in light areas.  ADoG extracts tone instead of lines. HDoG runs FDoG and ADoG separately and keeps a pixel only if both mark it as ink, combining clean structure with shading in one image."
        },
        {
          "question": "Which one should I use for a portrait vs. a landscape?",
          "answer": "Faces benefit from FDoG or HDoG. The flow-aligned blur keeps contours (jawlines, eyes) coherent instead of noisy. Landscapes with lots of fine texture (foliage, water) often look better with ADoG or HDoG, since XDoG/FDoG alone can't represent the tonal gradients of sky or shadow."
        },
        {
          "question": "My image looks noisy or grainy.  Which algorithm handles that best?",
          "answer": "FDoG specifically exists to fix this: by smoothing along the estimated edge direction rather than isotropically, it suppresses the \"fluctuating positive/negative response\" that appears in noisy image regions, which is what causes ragged lines in plain XDoG."
        },
        {
          "question": "Can I combine multiple algorithms on the same image?",
          "answer": "Yes, that's essentially what HDoG is under the hood: an FDoG pass for lines, an ADoG pass for tone, combined pixel-by-pixel. The ability to add layers and blending function lets you build the same kind of composite manually (e.g., stack an FDoG layer over an ADoG layer with a Multiply/Darken blend)."
        }
      ]
    },
    {
      "name": "Parameters",
      "items": [
        {
          "question": "Why does my HDoG output look thin in the darkest shadows even with high density settings?",
          "answer": "Larger primitives naturally need more spacing between them, which caps how dark a region can look purely from size. This tool/library's answer is a second ADoG pass at a larger scale, run only to fill in the darkest areas without disturbing lighter ones. If shadows look too sparse, adjust the adogSecondary parameter."
        },
        {
          "question": "Why does phi/epsilon barely seem to do anything at some settings?",
          "answer": "The threshold is a smooth tanh curve, not a hard cutoff, so at low phi values, changes to epsilon shift the transition gradually rather than producing a visible line."
        }
      ]
    },
    {
      "name": "Preprocessing",
      "items": [
        {
          "question": "Do I need to preprocess my image first?",
          "answer": "Not required, but it often improves results.  DoG-based filters are sensitive to noise, and cleaning that up before the DoG pass tends to give cleaner lines/tone than trying to compensate with sigma/phi alone. This is a general property of DoG-style edge detection."
        },
        {
          "question": "What's the difference between the preprocessing presets (light/standard/heavy/artistic/nature)?",
          "answer": "preprocessing.ts only mirrors the names of PreprocessingPresets from dogpack — the actual step combinations aren't in the files provided. This is one to pull from the dogpack source or ADVANCED.md rather than guess at; better to leave it as a placeholder than invent behavior."
        },
        {
          "question": "Can I preview what preprocessing alone does, before adding a DoG layer?",
          "answer": "Yes, when you change the preprocessing pipeline, the preview image will switch to the preprocessed image."
        }
      ]
    },
    {
      "name": "Layers and blending",
      "items": [
        {
          "question": "How do layers and blend modes work together?",
          "answer": "Layers let you run several DoG passes on the same image and combine them (the same idea as HDoG's own FDoG-AND-ADoG combination), just generalized so you aren't limited to one fixed recipe. Each layer can hold one or more DoG configs plus a blend mode describing how it merges with the layer below it."
        },
        {
          "question": "What's a good starting point for a lines + shading effect if I don't want to use HDoG directly?",
          "answer": "Stack an FDoG layer (for structure) over an ADoG layer (for tone) using a blend mode that keeps dark pixels from either layer.  This mirrors exactly what HDoG's logical AND is doing mathematically, just exposed as two separate, independently-tunable layers instead of one fixed combination."
        },
        {
          "question": "What's the difference between a \"DoG \" node and a \"layer\" node?",
          "answer": "A config node (DogConfigNode) is an XDoG, FDoG, ADoG, or HDoG configuration with its parameters. A layer node is a container that groups multiple nodes (configs or other layers) together with a name and a blend mode, so you can nest arbitrarily (e.g., a layer blending two sub-layers, each of which blends two configs)."
        },
        {
          "question": "Why would I nest layers instead of just adding more configs to one layer?",
          "answer": "Blend mode applies per-layer so if you want to combine A and B one way, then blend that combined result with C a different way, you need A+B in their own layer, blended into C at the outer level. Flat lists can't express that; nesting can."
        }
      ]
    },
    {
      "name": "Performance",
      "items": [
        {
          "question": "Why is FDoG/HDoG so much slower than XDoG?",
          "answer": "FDoG needs an extra flow-field computation (the edge tangent flow) before it can even start filtering, which is the main added cost over XDoG. HDoG is the most expensive of the four because it runs a full FDoG pass and two ADoG passes (the second one just for shadow detail) and then combines them — three filtering passes instead of one, even though each individual pass stays fast."
        },
        {
          "question": "Is this fast enough to preview in real time?",
          "answer": "The underlying algorithm is linear-time and GPU-parallelizable. Published benchmarks report 1000+ fps at HD resolution on a several-years-old mid-range GPU.  I am still learning GPU-optimization though, so it likely still needs improvements for that"
        }
      ]
    }
  ]
}