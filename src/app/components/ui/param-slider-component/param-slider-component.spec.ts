import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParamSliderComponent } from './param-slider-component';

describe('ParamSliderComponent', () => {
  let component: ParamSliderComponent;
  let fixture: ComponentFixture<ParamSliderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParamSliderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ParamSliderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
