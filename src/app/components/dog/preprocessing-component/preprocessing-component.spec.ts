import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PreprocessingComponent } from './preprocessing-component';

describe('PreprocessingComponent', () => {
  let component: PreprocessingComponent;
  let fixture: ComponentFixture<PreprocessingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreprocessingComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PreprocessingComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
