import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImageCanvasComponent } from './image-canvas';

describe('Image', () => {
  let component: ImageCanvasComponent;
  let fixture: ComponentFixture<ImageCanvasComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageCanvasComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ImageCanvasComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
